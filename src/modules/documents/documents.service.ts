import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { Document, DocumentDocument } from './schemas/document.schema';
import { User, UserDocument, UserRole, isBoardOrAbove } from '../users/schemas/user.schema';
import { UploadDocumentDto, UpdateDocumentDto, DocumentQueryDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { S3Service } from '../../shared/services/s3.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Upload a document
   */
  async upload(
    userId: string,
    orgId: string,
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ): Promise<DocumentDocument> {
    // Upload file to S3
    const fileKey = this.s3Service.generateKey('private/documents', file.originalname);
    const fileUrl = await this.s3Service.uploadBuffer(
      file.buffer,
      fileKey,
      file.mimetype,
      'private',
    );

    if (!dto.isOrganizationWide && !dto.buildingId) {
      throw new BadRequestException(
        'Either a building must be selected or the document must be marked as organization-wide.',
      );
    }

    const document = await this.documentModel.create({
      ...dto,
      ...(dto.buildingId ? { buildingId: new Types.ObjectId(dto.buildingId) } : {}),
      ...(dto.apartmentId ? { apartmentId: new Types.ObjectId(dto.apartmentId) } : {}),
      organizationId: new Types.ObjectId(orgId),
      uploadedById: new Types.ObjectId(userId),
      fileUrl,
      fileKey,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      isPublic: dto.isPublic ?? true,
      isOrganizationWide: dto.isOrganizationWide ?? false,
    });

    this.logger.log(`Document uploaded: ${document.title} (${document._id}) by user ${userId}`);

    return this.documentModel
      .findById(document._id)
      .populate('uploadedById', 'name avatarUrl avatarColor role')
      .exec() as Promise<DocumentDocument>;
  }

  /**
   * Find all documents with pagination and filters
   */
  async findAll(
    orgId: string,
    query: DocumentQueryDto,
  ): Promise<PaginatedResponseDto<DocumentDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      category,
      search,
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<DocumentDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    if (category) {
      filter.category = category;
    }

    // Text search
    if (search) {
      filter.$text = { $search: search };
    }

    // Apartment filter: show documents for a specific apartment
    if (query.apartmentId) {
      filter.apartmentId = new Types.ObjectId(query.apartmentId);
    }
    // Building filter: show items for the selected building or org-wide items
    else if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { isOrganizationWide: true },
      ];
    }

    const [documents, total] = await Promise.all([
      this.documentModel
        .find(filter)
        .populate('uploadedById', 'name avatarUrl avatarColor role')
        .sort(
          search
            ? { score: { $meta: 'textScore' }, [sortBy]: sortOrder === 'desc' ? -1 : 1 }
            : { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
        )
        .skip(skip)
        .limit(limit)
        .exec(),
      this.documentModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(documents, total, page, limit);
  }

  /**
   * Find document by ID
   */
  async findById(documentId: string): Promise<DocumentDocument> {
    const document = await this.documentModel
      .findById(documentId)
      .populate('uploadedById', 'name avatarUrl avatarColor email')
      .exec();

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /**
   * Update document (board only)
   */
  async update(
    documentId: string,
    userId: string,
    dto: UpdateDocumentDto,
  ): Promise<DocumentDocument> {
    const document = await this.findById(documentId);

    // Verify user is board member
    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isBoard) {
      throw new ForbiddenException('Only board members can update documents');
    }

    const updatedDocument = await this.documentModel
      .findByIdAndUpdate(documentId, { $set: dto }, { new: true, runValidators: true })
      .populate('uploadedById', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Document updated: ${documentId}`);
    return updatedDocument!;
  }

  /**
   * Delete document (board only)
   */
  async delete(documentId: string, userId: string): Promise<void> {
    const document = await this.findById(documentId);

    // Verify user is board member
    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isBoard) {
      throw new ForbiddenException('Only board members can delete documents');
    }

    // Delete file from S3
    try {
      await this.s3Service.deleteFile(document.fileKey);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${document.fileKey}`, error);
      // Continue with record deletion even if S3 deletion fails
    }

    // Delete document record
    await this.documentModel.deleteOne({ _id: documentId });

    this.logger.log(`Document deleted: ${documentId} by user ${userId}`);
  }

  /**
   * Get presigned download URL
   */
  async getDownloadUrl(documentId: string, userId: string): Promise<string> {
    const document = await this.findById(documentId);

    // Verify user has access (public documents or user is in same organization)
    // Note: In a real implementation, you might want to check if user is in the organization
    // For now, we'll allow access if document is public or user is board member
    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!document.isPublic && !isBoard) {
      throw new ForbiddenException('You do not have access to this document');
    }

    // Generate presigned URL (valid for 1 hour)
    const downloadUrl = await this.s3Service.getPresignedDownloadUrl(
      document.fileKey,
      3600,
    );

    this.logger.log(`Download URL generated for document: ${documentId}`);
    return downloadUrl;
  }
}


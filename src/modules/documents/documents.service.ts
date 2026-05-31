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
import { User, UserDocument, isBoardOrAbove } from '../users/schemas/user.schema';
import { UploadDocumentDto, UpdateDocumentDto, DocumentQueryDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { S3Service } from '../../shared/services/s3.service';
import { ConceptsService } from '../concepts/concepts.service';
import { DocumentFoldersService } from '../document-folders/document-folders.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly s3Service: S3Service,
    private readonly conceptsService: ConceptsService,
    private readonly foldersService: DocumentFoldersService,
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
    if (!dto.buildingId && !dto.conceptId && !dto.apartmentId) {
      throw new BadRequestException(
        'Either a building, concept, or apartment must be provided.',
      );
    }

    let conceptObjectId: Types.ObjectId | null = null;
    if (dto.conceptId) {
      await this.conceptsService.assertConceptInOrg(dto.conceptId, orgId);
      conceptObjectId = new Types.ObjectId(dto.conceptId);
    } else if (dto.buildingId) {
      conceptObjectId = await this.conceptsService.findConceptIdForBuilding(
        dto.buildingId,
        orgId,
      );
    }

    // Validate folder scope before uploading the file to S3 — avoids leaving
    // orphan S3 objects when validation fails.
    if (dto.folderId) {
      await this.foldersService.assertFolderMatchesScope(
        dto.folderId,
        orgId,
        conceptObjectId,
        dto.buildingId,
      );
    }

    const fileKey = this.s3Service.generateKey('private/documents', file.originalname);
    const fileUrl = await this.s3Service.uploadBuffer(
      file.buffer,
      fileKey,
      file.mimetype,
    );

    const document = await this.documentModel.create({
      ...dto,
      ...(dto.buildingId ? { buildingId: new Types.ObjectId(dto.buildingId) } : {}),
      ...(conceptObjectId ? { conceptId: conceptObjectId } : {}),
      ...(dto.apartmentId ? { apartmentId: new Types.ObjectId(dto.apartmentId) } : {}),
      ...(dto.folderId ? { folderId: new Types.ObjectId(dto.folderId) } : {}),
      organizationId: new Types.ObjectId(orgId),
      uploadedById: new Types.ObjectId(userId),
      fileUrl,
      fileKey,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      isPublic: dto.isPublic ?? true,
      isConceptWide: dto.isConceptWide ?? false,
    });

    if (dto.folderId) {
      await this.foldersService.incrementCount(dto.folderId);
    }

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
    role: string,
    query: DocumentQueryDto,
  ): Promise<PaginatedResponseDto<DocumentDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      folderId,
      search,
    } = query;

    const skip = (page - 1) * limit;

    const filter: QueryFilter<DocumentDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    // Residents only see public documents — matches getDownloadUrl's access
    // check so the list can't surface docs that can't be opened.
    if (!isBoardOrAbove(role)) {
      filter.isPublic = true;
    }

    if (folderId === 'null') {
      // Special sentinel: documents with no folder (the "Ikke sortert" view).
      filter.$or = [
        { folderId: { $exists: false } },
        { folderId: null },
      ];
    } else if (folderId) {
      filter.folderId = new Types.ObjectId(folderId);
    }

    if (search) {
      filter.$text = { $search: search };
    }

    if (query.apartmentId) {
      filter.apartmentId = new Types.ObjectId(query.apartmentId);
    } else {
      let scopeConceptId: Types.ObjectId | null = null;
      if (query.conceptId) {
        scopeConceptId = new Types.ObjectId(query.conceptId);
      } else if (query.buildingId) {
        const derived = await this.conceptsService.findConceptIdForBuilding(
          query.buildingId,
          orgId,
        );
        scopeConceptId = derived ?? null;
        if (!derived) {
          this.logger.warn(
            `Building ${query.buildingId} has no conceptId; ` +
              `concept-wide documents will be omitted from this query`,
          );
        }
      }

      if (query.buildingId) {
        if (scopeConceptId) {
          filter.conceptId = scopeConceptId;
          const buildingOr = [
            { buildingId: new Types.ObjectId(query.buildingId) },
            { isConceptWide: true },
          ];
          if (filter.$or) {
            const existingOr = filter.$or;
            delete filter.$or;
            filter.$and = [{ $or: existingOr }, { $or: buildingOr }];
          } else {
            filter.$or = buildingOr;
          }
        } else {
          filter.buildingId = new Types.ObjectId(query.buildingId);
        }
      } else if (scopeConceptId) {
        filter.conceptId = scopeConceptId;
      }
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
    orgId: string,
    dto: UpdateDocumentDto,
  ): Promise<DocumentDocument> {
    const document = await this.findById(documentId);

    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isBoard) {
      throw new ForbiddenException('Only board members can update documents');
    }

    const previousFolderId = document.folderId
      ? document.folderId.toString()
      : null;
    let nextFolderId: string | null = previousFolderId;

    const setFields: Record<string, unknown> = {};
    const unsetFields: Record<string, unknown> = {};

    if (dto.title !== undefined) setFields.title = dto.title;
    if (dto.description !== undefined) setFields.description = dto.description;
    if (dto.isPublic !== undefined) setFields.isPublic = dto.isPublic;

    if (dto.folderId !== undefined) {
      if (dto.folderId === null) {
        unsetFields.folderId = '';
        nextFolderId = null;
      } else {
        const conceptObjectId = document.conceptId ?? null;
        const buildingId = document.buildingId
          ? document.buildingId.toString()
          : undefined;
        await this.foldersService.assertFolderMatchesScope(
          dto.folderId,
          orgId,
          conceptObjectId,
          buildingId,
        );
        setFields.folderId = new Types.ObjectId(dto.folderId);
        nextFolderId = dto.folderId;
      }
    }

    const updateOps: Record<string, unknown> = {};
    if (Object.keys(setFields).length) updateOps.$set = setFields;
    if (Object.keys(unsetFields).length) updateOps.$unset = unsetFields;

    const updatedDocument = await this.documentModel
      .findByIdAndUpdate(documentId, updateOps, {
        new: true,
        runValidators: true,
      })
      .populate('uploadedById', 'name avatarUrl avatarColor role')
      .exec();

    if (previousFolderId !== nextFolderId) {
      if (previousFolderId) {
        await this.foldersService.decrementCount(previousFolderId);
      }
      if (nextFolderId) {
        await this.foldersService.incrementCount(nextFolderId);
      }
    }

    this.logger.log(`Document updated: ${documentId}`);
    return updatedDocument!;
  }

  /**
   * Delete document (board only)
   */
  async delete(documentId: string, userId: string): Promise<void> {
    const document = await this.findById(documentId);

    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!isBoard) {
      throw new ForbiddenException('Only board members can delete documents');
    }

    try {
      await this.s3Service.deleteFile(document.fileKey);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${document.fileKey}`, error);
    }

    await this.documentModel.deleteOne({ _id: documentId });

    if (document.folderId) {
      await this.foldersService.decrementCount(document.folderId);
    }

    this.logger.log(`Document deleted: ${documentId} by user ${userId}`);
  }

  /**
   * Get presigned download URL
   */
  async getDownloadUrl(documentId: string, userId: string): Promise<string> {
    const document = await this.findById(documentId);

    const user = await this.userModel.findById(userId);
    const isBoard = user && isBoardOrAbove(user.role);

    if (!document.isPublic && !isBoard) {
      throw new ForbiddenException('You do not have access to this document');
    }

    const downloadUrl = await this.s3Service.getPresignedDownloadUrl(
      document.fileKey,
      3600,
      {
        disposition: 'inline',
        filename: document.fileName,
        contentType: document.mimeType,
      },
    );

    this.logger.log(`Download URL generated for document: ${documentId}`);
    return downloadUrl;
  }
}

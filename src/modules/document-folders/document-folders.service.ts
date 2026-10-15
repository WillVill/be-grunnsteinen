import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import {
  DocumentFolder,
  DocumentFolderDocument,
} from './schemas/document-folder.schema';
import {
  Document as DocumentEntity,
  DocumentDocument,
} from '../documents/schemas/document.schema';
import {
  CreateDocumentFolderDto,
  UpdateDocumentFolderDto,
  DocumentFolderQueryDto,
} from './dto';
import { ConceptsService } from '../concepts/concepts.service';
import { isBoardOrAbove } from '../users/schemas/user.schema';

@Injectable()
export class DocumentFoldersService {
  private readonly logger = new Logger(DocumentFoldersService.name);

  constructor(
    @InjectModel(DocumentFolder.name)
    private readonly folderModel: Model<DocumentFolderDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    private readonly conceptsService: ConceptsService,
  ) {}

  async create(
    userId: string,
    orgId: string,
    dto: CreateDocumentFolderDto,
  ): Promise<DocumentFolderDocument> {
    if (!dto.conceptId && !dto.buildingId && !dto.parentId) {
      throw new BadRequestException(
        'Either conceptId, buildingId or parentId must be provided.',
      );
    }

    let conceptObjectId: Types.ObjectId;
    let buildingObjectId: Types.ObjectId | undefined;
    let parentObjectId: Types.ObjectId | undefined;
    if (dto.parentId) {
      // Subfolders always share their parent's scope — whatever scope the
      // client sent is ignored so a subtree can never span buildings.
      const parent = await this.folderModel.findOne({
        _id: new Types.ObjectId(dto.parentId),
        organizationId: new Types.ObjectId(orgId),
      });
      if (!parent) {
        throw new NotFoundException(`Mappe "${dto.parentId}" finnes ikke`);
      }
      conceptObjectId = parent.conceptId;
      buildingObjectId = parent.buildingId ?? undefined;
      parentObjectId = parent._id as Types.ObjectId;
    } else if (dto.conceptId) {
      await this.conceptsService.assertConceptInOrg(dto.conceptId, orgId);
      if (dto.buildingId) {
        await this.conceptsService.assertBuildingInConcept(dto.buildingId, dto.conceptId, orgId);
      }
      conceptObjectId = new Types.ObjectId(dto.conceptId);
      buildingObjectId = dto.buildingId
        ? new Types.ObjectId(dto.buildingId)
        : undefined;
    } else {
      conceptObjectId = await this.conceptsService.requireConceptIdForBuilding(
        dto.buildingId!,
        orgId,
      );
      buildingObjectId = new Types.ObjectId(dto.buildingId);
    }

    try {
      const folder = await this.folderModel.create({
        organizationId: new Types.ObjectId(orgId),
        conceptId: conceptObjectId,
        ...(buildingObjectId ? { buildingId: buildingObjectId } : {}),
        ...(parentObjectId ? { parentId: parentObjectId } : {}),
        name: dto.name.trim(),
        description: dto.description?.trim(),
        createdById: new Types.ObjectId(userId),
        documentCount: 0,
      });

      this.logger.log(`Folder created: ${folder.name} (${folder._id})`);
      return folder;
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException(
          `En mappe med navnet "${dto.name}" finnes allerede her`,
        );
      }
      throw err;
    }
  }

  async findAll(
    orgId: string,
    role: string,
    query: DocumentFolderQueryDto,
  ): Promise<DocumentFolderDocument[]> {
    const filter: QueryFilter<DocumentFolderDocument> = {
      organizationId: new Types.ObjectId(orgId),
    };

    let scopeConceptId: Types.ObjectId | null = null;
    if (query.conceptId) {
      scopeConceptId = new Types.ObjectId(query.conceptId);
    } else if (query.buildingId) {
      const derived = await this.conceptsService.findConceptIdForBuilding(
        query.buildingId,
        orgId,
      );
      scopeConceptId = derived ?? null;
    }

    if (scopeConceptId) {
      filter.conceptId = scopeConceptId;
    }

    if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { buildingId: { $exists: false } },
        { buildingId: null },
      ];
    }

    const folders = await this.folderModel.find(filter).sort({ name: 1 }).exec();

    // Board+ sees every folder (including empty ones) so they can manage them.
    // Residents only see folders whose subtree contains at least one document
    // they can access — an empty subfolder hides, but its non-empty sibling
    // keeps the shared parent visible. documentCount is replaced with the
    // visible direct count so the card label matches what they can open.
    if (isBoardOrAbove(role)) {
      return folders;
    }

    if (folders.length === 0) {
      return folders;
    }

    const folderIds = folders.map((f) => f._id);
    const visibleCounts = await this.documentModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      {
        $match: {
          folderId: { $in: folderIds },
          isPublic: true,
        },
      },
      { $group: { _id: '$folderId', count: { $sum: 1 } } },
    ]);

    const countByFolderId = new Map(
      visibleCounts.map((row) => [row._id.toString(), row.count]),
    );
    const folderById = new Map(folders.map((f) => [f._id.toString(), f]));

    // Walk up from every non-empty folder, marking its ancestors visible.
    // Stops at an already-visible folder, which also guards against cycles.
    const visibleIds = new Set<string>();
    for (const folderId of countByFolderId.keys()) {
      let current = folderById.get(folderId);
      while (current && !visibleIds.has(current._id.toString())) {
        visibleIds.add(current._id.toString());
        current = current.parentId
          ? folderById.get(current.parentId.toString())
          : undefined;
      }
    }

    return folders
      .filter((folder) => visibleIds.has(folder._id.toString()))
      .map((folder) => {
        const obj = folder.toObject();
        obj.documentCount = countByFolderId.get(folder._id.toString()) ?? 0;
        return obj as DocumentFolderDocument;
      });
  }

  async findById(
    folderId: string,
    orgId: string,
  ): Promise<DocumentFolderDocument> {
    const folder = await this.folderModel
      .findOne({
        _id: new Types.ObjectId(folderId),
        organizationId: new Types.ObjectId(orgId),
      })
      .exec();
    if (!folder) {
      throw new NotFoundException(`Mappe "${folderId}" finnes ikke`);
    }
    return folder;
  }

  async update(
    folderId: string,
    orgId: string,
    dto: UpdateDocumentFolderDto,
  ): Promise<DocumentFolderDocument> {
    const folder = await this.folderModel.findOne({
      _id: new Types.ObjectId(folderId),
      organizationId: new Types.ObjectId(orgId),
    });

    if (!folder) {
      throw new NotFoundException(`Mappe "${folderId}" finnes ikke`);
    }

    try {
      const updated = await this.folderModel
        .findByIdAndUpdate(
          folderId,
          {
            $set: {
              ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
              ...(dto.description !== undefined
                ? { description: dto.description?.trim() }
                : {}),
            },
          },
          { new: true, runValidators: true },
        )
        .exec();

      this.logger.log(`Folder updated: ${folderId}`);
      return updated!;
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException(
          `En mappe med navnet "${dto.name}" finnes allerede her`,
        );
      }
      throw err;
    }
  }

  async delete(folderId: string, orgId: string): Promise<void> {
    const folder = await this.folderModel.findOne({
      _id: new Types.ObjectId(folderId),
      organizationId: new Types.ObjectId(orgId),
    });

    if (!folder) {
      throw new NotFoundException(`Mappe "${folderId}" finnes ikke`);
    }

    // Re-count from documents collection to avoid trusting a stale denormalized
    // counter (deletes are rare so the extra query is cheap insurance).
    const documentCount = await this.documentModel.countDocuments({
      folderId: folder._id,
    });

    if (documentCount > 0) {
      throw new BadRequestException(
        `Mappen inneholder ${documentCount} dokument${documentCount === 1 ? '' : 'er'}. Flytt eller slett dokumentene før du sletter mappen.`,
      );
    }

    const subfolderCount = await this.folderModel.countDocuments({
      parentId: folder._id,
    });

    if (subfolderCount > 0) {
      throw new BadRequestException(
        `Mappen inneholder ${subfolderCount} undermappe${subfolderCount === 1 ? '' : 'r'}. Slett undermappene før du sletter mappen.`,
      );
    }

    await this.folderModel.deleteOne({ _id: folder._id });
    this.logger.log(`Folder deleted: ${folderId}`);
  }

  /**
   * Validates that a folder exists, belongs to the org, and matches the given
   * scope (building-specific or concept-wide).
   *
   * Called from DocumentsService.upload to enforce that uploaded docs cannot
   * be placed in mismatched folders.
   */
  async assertFolderMatchesScope(
    folderId: string,
    orgId: string,
    conceptObjectId: Types.ObjectId | null,
    buildingId: string | undefined,
  ): Promise<DocumentFolderDocument> {
    const folder = await this.folderModel.findOne({
      _id: new Types.ObjectId(folderId),
      organizationId: new Types.ObjectId(orgId),
    });

    if (!folder) {
      throw new NotFoundException(`Mappe "${folderId}" finnes ikke`);
    }

    if (
      conceptObjectId &&
      folder.conceptId.toString() !== conceptObjectId.toString()
    ) {
      throw new BadRequestException(
        'Mappen tilhører et annet konsept enn dokumentet',
      );
    }

    if (folder.buildingId && buildingId) {
      if (folder.buildingId.toString() !== buildingId) {
        throw new BadRequestException(
          'Mappen tilhører en annen bygning enn dokumentet',
        );
      }
    }

    return folder;
  }

  async incrementCount(folderId: Types.ObjectId | string): Promise<void> {
    await this.folderModel.updateOne(
      { _id: folderId },
      { $inc: { documentCount: 1 } },
    );
  }

  async decrementCount(folderId: Types.ObjectId | string): Promise<void> {
    await this.folderModel.updateOne(
      { _id: folderId, documentCount: { $gt: 0 } },
      { $inc: { documentCount: -1 } },
    );
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: number }).code === 11000;
}

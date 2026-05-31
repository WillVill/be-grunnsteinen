import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Concept, ConceptDocument } from "./schemas/concept.schema";
import { Building, BuildingDocument } from "../buildings/schemas/building.schema";
import { CreateConceptDto, UpdateConceptDto } from "./dto";
import { S3Service } from "../../shared/services/s3.service";

@Injectable()
export class ConceptsService {
  private readonly logger = new Logger(ConceptsService.name);

  constructor(
    @InjectModel(Concept.name)
    private readonly conceptModel: Model<ConceptDocument>,
    @InjectModel(Building.name)
    private readonly buildingModel: Model<BuildingDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async create(
    organizationId: string,
    dto: CreateConceptDto,
  ): Promise<ConceptDocument> {
    const concept = new this.conceptModel({
      ...dto,
      organizationId: new Types.ObjectId(organizationId),
    });
    try {
      await concept.save();
    } catch (err: unknown) {
      // Rely on the {organizationId, code} unique+sparse index for atomicity
      // rather than a pre-insert check (which races under concurrent writes).
      if (isDuplicateKeyError(err)) {
        throw new ConflictException(
          `Concept with code "${dto.code}" already exists in this organization`,
        );
      }
      throw err;
    }
    this.logger.log(`Concept created: ${concept.name} (${concept._id})`);
    return concept;
  }

  async findAll(organizationId: string): Promise<ConceptDocument[]> {
    return this.conceptModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  async findOne(
    organizationId: string,
    id: string,
  ): Promise<ConceptDocument> {
    const concept = await this.conceptModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!concept) {
      throw new NotFoundException(`Concept "${id}" not found`);
    }
    return concept;
  }

  /**
   * Resolve the conceptId for a building in the caller's organization.
   * Throws NotFoundException if the building does not exist or belongs to a
   * different organization (use this when missing data must surface as an
   * error, e.g. when writing new content). Returns null only when the building
   * exists but has no conceptId (pre-migration data).
   */
  async findConceptIdForBuilding(
    buildingId: string,
    organizationId: string,
  ): Promise<Types.ObjectId | null> {
    const building = await this.buildingModel
      .findOne({
        _id: new Types.ObjectId(buildingId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .select("conceptId");
    if (!building) {
      throw new NotFoundException(`Building "${buildingId}" not found`);
    }
    return (building.conceptId as Types.ObjectId | undefined) ?? null;
  }

  /**
   * Same as findConceptIdForBuilding, but throws if the building has no
   * conceptId assigned. Use this on write paths where a missing concept is a
   * data-integrity error rather than legitimate state.
   */
  async requireConceptIdForBuilding(
    buildingId: string,
    organizationId: string,
  ): Promise<Types.ObjectId> {
    const conceptId = await this.findConceptIdForBuilding(
      buildingId,
      organizationId,
    );
    if (!conceptId) {
      throw new BadRequestException(
        `Building "${buildingId}" is not yet assigned to a concept. ` +
          `Run the concepts migration or assign a concept before continuing.`,
      );
    }
    return conceptId;
  }

  /**
   * Used by other services to validate that a conceptId belongs to the caller's
   * organization AND is active. Throws ForbiddenException for missing/foreign,
   * BadRequestException for inactive (so callers can distinguish the two).
   */
  async assertConceptInOrg(
    conceptId: string,
    organizationId: string,
  ): Promise<ConceptDocument> {
    const concept = await this.conceptModel.findOne({
      _id: new Types.ObjectId(conceptId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!concept) {
      throw new ForbiddenException(
        `Concept "${conceptId}" is not accessible in this organization`,
      );
    }
    if (!concept.isActive) {
      throw new BadRequestException(
        `Concept "${conceptId}" is inactive and cannot be used for new content`,
      );
    }
    return concept;
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateConceptDto,
  ): Promise<ConceptDocument> {
    let concept: ConceptDocument | null;
    try {
      concept = await this.conceptModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: dto },
        { new: true, runValidators: true },
      );
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException(
          `Concept with code "${dto.code}" already exists in this organization`,
        );
      }
      throw err;
    }

    if (!concept) {
      throw new NotFoundException(`Concept "${id}" not found`);
    }

    this.logger.log(`Concept updated: ${concept.name} (${concept._id})`);
    return concept;
  }

  async remove(
    organizationId: string,
    id: string,
  ): Promise<ConceptDocument> {
    // Block soft-delete if ANY buildings still reference the concept — even
    // inactive ones — to avoid leaving orphaned references that resurface if a
    // building is reactivated.
    const buildingCount = await this.buildingModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      conceptId: new Types.ObjectId(id),
    });

    if (buildingCount > 0) {
      throw new ConflictException(
        `Concept has ${buildingCount} building(s) referencing it. Reassign them first.`,
      );
    }

    const concept = await this.conceptModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      },
      { $set: { isActive: false } },
      { new: true },
    );

    if (!concept) {
      throw new NotFoundException(`Concept "${id}" not found`);
    }

    return concept;
  }

  async uploadLogo(
    organizationId: string,
    id: string,
    file: Express.Multer.File,
  ): Promise<ConceptDocument> {
    const concept = await this.findOne(organizationId, id);

    if (concept.logoUrl) {
      await this.s3Service.deleteFileByUrl(concept.logoUrl).catch((error) => {
        this.logger.warn(`Failed to delete old concept logo: ${error.message}`);
      });
    }

    const logoUrl = await this.s3Service.uploadFile(
      file,
      `public/organizations/${organizationId}/concepts/${id}/logos`,
    );

    concept.logoUrl = logoUrl;
    await concept.save();
    this.logger.log(`Logo uploaded for concept: ${concept.name}`);
    return concept;
  }

  async getStats(
    organizationId: string,
    id: string,
  ): Promise<{ buildingCount: number }> {
    await this.findOne(organizationId, id);
    const buildingCount = await this.buildingModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      conceptId: new Types.ObjectId(id),
      isActive: true,
    });
    return { buildingCount };
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: number }).code === 11000;
}

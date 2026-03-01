import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Apartment, ApartmentDocument } from "./schemas/apartment.schema";
import { Building, BuildingDocument } from "../buildings/schemas/building.schema";
import { User, UserDocument } from "../users/schemas/user.schema";
import {
  CreateApartmentDto,
  UpdateApartmentDto,
  ApartmentQueryDto,
  AssignTenantDto,
} from "./dto";
import { PaginatedResponseDto } from "../../common/dto/pagination.dto";

@Injectable()
export class ApartmentsService {
  constructor(
    @InjectModel(Apartment.name)
    private apartmentModel: Model<ApartmentDocument>,
    @InjectModel(Building.name)
    private buildingModel: Model<BuildingDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async create(
    organizationId: string,
    createApartmentDto: CreateApartmentDto,
  ): Promise<Apartment> {
    // Verify building exists and belongs to organization
    const building = await this.buildingModel.findOne({
      _id: new Types.ObjectId(createApartmentDto.buildingId),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!building) {
      throw new NotFoundException(
        `Building with ID "${createApartmentDto.buildingId}" not found`,
      );
    }

    // Check for duplicate unitNumber within building
    const existing = await this.apartmentModel.findOne({
      buildingId: new Types.ObjectId(createApartmentDto.buildingId),
      unitNumber: createApartmentDto.unitNumber,
    });

    if (existing) {
      throw new ConflictException(
        `Apartment with unit number "${createApartmentDto.unitNumber}" already exists in this building`,
      );
    }

    const apartment = new this.apartmentModel({
      ...createApartmentDto,
      organizationId: new Types.ObjectId(organizationId),
      buildingId: new Types.ObjectId(createApartmentDto.buildingId),
    });

    return apartment.save();
  }

  async findAllByBuilding(
    organizationId: string,
    query: ApartmentQueryDto,
  ): Promise<PaginatedResponseDto<Apartment>> {
    const { page = 1, limit = 50, search, isActive, buildingId } = query;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    if (buildingId) {
      filter.buildingId = new Types.ObjectId(buildingId);
    }

    if (typeof isActive === "boolean") {
      filter.isActive = isActive;
    }

    if (search) {
      filter.$or = [
        { unitNumber: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const [apartments, total] = await Promise.all([
      this.apartmentModel
        .find(filter)
        .populate("tenantIds", "-password -passwordResetToken -passwordResetExpires")
        .sort({ unitNumber: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.apartmentModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(apartments, total, page, limit);
  }

  async findOne(organizationId: string, apartmentId: string): Promise<Apartment> {
    const apartment = await this.apartmentModel
      .findOne({
        _id: new Types.ObjectId(apartmentId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate("tenantIds", "-password -passwordResetToken -passwordResetExpires");

    if (!apartment) {
      throw new NotFoundException(
        `Apartment with ID "${apartmentId}" not found`,
      );
    }

    return apartment;
  }

  async update(
    organizationId: string,
    apartmentId: string,
    updateApartmentDto: UpdateApartmentDto,
  ): Promise<Apartment> {
    // Check unitNumber uniqueness if updating unitNumber
    if (updateApartmentDto.unitNumber) {
      const apartment = await this.apartmentModel.findOne({
        _id: new Types.ObjectId(apartmentId),
        organizationId: new Types.ObjectId(organizationId),
      });

      if (!apartment) {
        throw new NotFoundException(
          `Apartment with ID "${apartmentId}" not found`,
        );
      }

      const existing = await this.apartmentModel.findOne({
        buildingId: apartment.buildingId,
        unitNumber: updateApartmentDto.unitNumber,
        _id: { $ne: new Types.ObjectId(apartmentId) },
      });

      if (existing) {
        throw new ConflictException(
          `Apartment with unit number "${updateApartmentDto.unitNumber}" already exists in this building`,
        );
      }
    }

    // Remove buildingId from update payload - apartments shouldn't move between buildings
    const { buildingId, ...updateData } = updateApartmentDto;

    const apartment = await this.apartmentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(apartmentId),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: updateData },
        { new: true },
      )
      .populate("tenantIds", "-password -passwordResetToken -passwordResetExpires");

    if (!apartment) {
      throw new NotFoundException(
        `Apartment with ID "${apartmentId}" not found`,
      );
    }

    return apartment;
  }

  async remove(organizationId: string, apartmentId: string): Promise<Apartment> {
    const apartment = await this.apartmentModel.findOne({
      _id: new Types.ObjectId(apartmentId),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!apartment) {
      throw new NotFoundException(
        `Apartment with ID "${apartmentId}" not found`,
      );
    }

    if (apartment.tenantIds?.length) {
      throw new BadRequestException(
        "Cannot deactivate apartment with assigned tenants. Remove all tenants first.",
      );
    }

    apartment.isActive = false;
    return apartment.save();
  }

  async assignTenant(
    organizationId: string,
    apartmentId: string,
    assignTenantDto: AssignTenantDto,
  ): Promise<Apartment> {
    const apartment = await this.apartmentModel.findOne({
      _id: new Types.ObjectId(apartmentId),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!apartment) {
      throw new NotFoundException(
        `Apartment with ID "${apartmentId}" not found`,
      );
    }

    const userObjectId = new Types.ObjectId(assignTenantDto.userId);

    if (apartment.tenantIds?.some((id) => id.equals(userObjectId))) {
      throw new BadRequestException(
        "This user is already a tenant of this apartment.",
      );
    }

    const user = await this.userModel.findOne({
      _id: userObjectId,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!user) {
      throw new NotFoundException(
        `User with ID "${assignTenantDto.userId}" not found`,
      );
    }

    // Auto-add user to building if not already assigned
    const buildingObjectId = apartment.buildingId;
    if (!user.buildingIds?.some((id) => id.equals(buildingObjectId))) {
      const updateOps: Record<string, unknown> = {
        $addToSet: { buildingIds: buildingObjectId },
      };

      // Set as primary building if user has no primary
      if (!user.primaryBuildingId) {
        updateOps.$set = { primaryBuildingId: buildingObjectId };
      }

      await this.userModel.findByIdAndUpdate(assignTenantDto.userId, updateOps);
    }

    // Add tenant to apartment
    await this.apartmentModel.findByIdAndUpdate(apartmentId, {
      $addToSet: { tenantIds: userObjectId },
    });

    // Return populated apartment
    return this.findOne(organizationId, apartmentId);
  }

  async removeTenant(
    organizationId: string,
    apartmentId: string,
    userId: string,
  ): Promise<Apartment> {
    const apartment = await this.apartmentModel.findOne({
      _id: new Types.ObjectId(apartmentId),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!apartment) {
      throw new NotFoundException(
        `Apartment with ID "${apartmentId}" not found`,
      );
    }

    const userObjectId = new Types.ObjectId(userId);

    if (!apartment.tenantIds?.some((id) => id.equals(userObjectId))) {
      throw new BadRequestException("This user is not a tenant of this apartment.");
    }

    await this.apartmentModel.findByIdAndUpdate(apartmentId, {
      $pull: { tenantIds: userObjectId },
    });

    // Return populated apartment
    return this.findOne(organizationId, apartmentId);
  }
}

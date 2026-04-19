import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Organization, OrganizationDocument } from './schemas/organization.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
import { S3Service } from '../../shared/services/s3.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Create a new organization (admin only)
   */
  async create(
    createDto: CreateOrganizationDto,
  ): Promise<OrganizationDocument> {
    // Check if code already exists
    const existingOrg = await this.organizationModel.findOne({
      code: createDto.code.toUpperCase(),
    });

    if (existingOrg) {
      throw new ConflictException('Organization code already exists');
    }

    const organization = await this.organizationModel.create({
      ...createDto,
      code: createDto.code.toUpperCase(),
    });

    this.logger.log(`Organization created: ${organization.name} (${organization.code})`);
    return organization;
  }

  /**
   * Find organization by ID
   */
  async findById(id: string): Promise<OrganizationDocument> {
    const organization = await this.organizationModel.findById(id);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  /**
   * Find organization by code
   */
  async findByCode(code: string): Promise<OrganizationDocument | null> {
    return this.organizationModel.findOne({
      code: code.toUpperCase(),
      isActive: true,
    });
  }

  /**
   * Update organization
   */
  async update(
    id: string,
    updateDto: UpdateOrganizationDto,
  ): Promise<OrganizationDocument> {
    // If updating code, check for conflicts
    if (updateDto.code) {
      const existingOrg = await this.organizationModel.findOne({
        code: updateDto.code.toUpperCase(),
        _id: { $ne: id },
      });

      if (existingOrg) {
        throw new ConflictException('Organization code already exists');
      }

      updateDto.code = updateDto.code.toUpperCase();
    }

    const organization = await this.organizationModel.findByIdAndUpdate(
      id,
      { $set: updateDto },
      { new: true, runValidators: true },
    );

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    this.logger.log(`Organization updated: ${organization.name}`);
    return organization;
  }

  /**
   * Upload organization logo
   */
  async uploadLogo(
    id: string,
    file: Express.Multer.File,
  ): Promise<OrganizationDocument> {
    const organization = await this.findById(id);

    // Delete old logo if exists
    if (organization.logoUrl) {
      await this.s3Service.deleteFileByUrl(organization.logoUrl).catch((error) => {
        this.logger.warn(`Failed to delete old logo: ${error.message}`);
      });
    }

    // Upload new logo
    const logoUrl = await this.s3Service.uploadFile(file, `public/organizations/${id}/logos`);

    // Update organization
    organization.logoUrl = logoUrl;
    await organization.save();

    this.logger.log(`Logo uploaded for organization: ${organization.name}`);
    return organization;
  }

  /**
   * Get organization statistics
   */
  async getStats(id: string): Promise<{
    userCount: number;
    activeBookings: number;
    upcomingEvents: number;
  }> {
    const organization = await this.findById(id);

    // Count active users
    const userCount = await this.countUsers(id);

    // Count active bookings (to be implemented when bookings module is created)
    const activeBookings = await this.countActiveBookings(id);

    // Count upcoming events (to be implemented when events module is created)
    const upcomingEvents = await this.countUpcomingEvents(id);

    return {
      userCount,
      activeBookings,
      upcomingEvents,
    };
  }

  /**
   * Count users in organization
   */
  private async countUsers(organizationId: string): Promise<number> {
    return this.userModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    });
  }

  /**
   * Count active bookings (placeholder - to be implemented)
   */
  private async countActiveBookings(organizationId: string): Promise<number> {
    // TODO: Implement when bookings module is created
    return 0;
  }

  /**
   * Count upcoming events (placeholder - to be implemented)
   */
  private async countUpcomingEvents(organizationId: string): Promise<number> {
    // TODO: Implement when events module is created
    return 0;
  }
}


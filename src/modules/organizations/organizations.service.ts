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
import { Building, BuildingDocument } from '../buildings/schemas/building.schema';
import { Concept, ConceptDocument } from '../concepts/schemas/concept.schema';
import {
  Booking,
  BookingDocument,
  BookingStatus,
} from '../bookings/schemas/booking.schema';
import {
  Event,
  EventDocument,
  EventStatus,
} from '../events/schemas/event.schema';
import { Post, PostDocument } from '../posts/schemas/post.schema';
import {
  HelpRequest,
  HelpRequestDocument,
  HelpRequestStatus,
} from '../sharing/schemas/help-request.schema';
import {
  TenantProfile,
  TenantProfileDocument,
  TenantProfileStatus,
} from '../tenant-profiles/schemas/tenant-profile.schema';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
import { S3Service } from '../../shared/services/s3.service';

export interface OrganizationStats {
  userCount: number;
  buildingCount: number;
  conceptCount: number;
  totalResidents: number;
  registeredResidents: number;
  activeBookings: number;
  pendingBookings: number;
  upcomingEvents: number;
  totalPosts: number;
  openHelpRequests: number;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Building.name)
    private readonly buildingModel: Model<BuildingDocument>,
    @InjectModel(Concept.name)
    private readonly conceptModel: Model<ConceptDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(HelpRequest.name)
    private readonly helpRequestModel: Model<HelpRequestDocument>,
    @InjectModel(TenantProfile.name)
    private readonly tenantProfileModel: Model<TenantProfileDocument>,
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
   * Get organization statistics.
   * All counts are aggregated server-side so the admin overview never has to
   * fetch and count paginated collections client-side.
   */
  async getStats(id: string): Promise<OrganizationStats> {
    // Ensures the org exists (throws 404 otherwise)
    await this.findById(id);

    const orgId = new Types.ObjectId(id);
    const now = new Date();

    const [
      userCount,
      buildingCount,
      conceptCount,
      totalResidents,
      registeredResidents,
      activeBookings,
      pendingBookings,
      upcomingEvents,
      totalPosts,
      openHelpRequests,
    ] = await Promise.all([
      this.userModel.countDocuments({ organizationId: orgId, isActive: true }),
      this.buildingModel.countDocuments({ organizationId: orgId, isActive: true }),
      this.conceptModel.countDocuments({ organizationId: orgId, isActive: true }),
      this.tenantProfileModel.countDocuments({ organizationId: orgId }),
      this.tenantProfileModel.countDocuments({
        organizationId: orgId,
        status: TenantProfileStatus.REGISTERED,
      }),
      this.bookingModel.countDocuments({
        organizationId: orgId,
        status: BookingStatus.CONFIRMED,
        endDate: { $gte: now },
      }),
      this.bookingModel.countDocuments({
        organizationId: orgId,
        status: BookingStatus.PENDING,
      }),
      this.eventModel.countDocuments({
        organizationId: orgId,
        status: { $ne: EventStatus.CANCELLED },
        startDate: { $gte: now },
      }),
      this.postModel.countDocuments({ organizationId: orgId }),
      this.helpRequestModel.countDocuments({
        organizationId: orgId,
        status: HelpRequestStatus.OPEN,
      }),
    ]);

    return {
      userCount,
      buildingCount,
      conceptCount,
      totalResidents,
      registeredResidents,
      activeBookings,
      pendingBookings,
      upcomingEvents,
      totalPosts,
      openHelpRequests,
    };
  }
}


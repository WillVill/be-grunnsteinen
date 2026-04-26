import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { Resource, ResourceDocument } from './schemas/resource.schema';
import { CreateResourceDto, UpdateResourceDto, ResourceQueryDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { S3Service } from '../../shared/services/s3.service';

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    @InjectModel(Resource.name)
    private readonly resourceModel: Model<ResourceDocument>,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Create a new resource (board only)
   */
  async create(
    organizationId: string,
    createDto: CreateResourceDto,
  ): Promise<ResourceDocument> {
    if (!createDto.isOrganizationWide && !createDto.buildingId) {
      throw new BadRequestException(
        'Either a building must be selected or the resource must be marked as organization-wide.',
      );
    }

    const { galleryKey, ...rest } = createDto;

    const resource = await this.resourceModel.create({
      ...rest,
      ...(rest.buildingId
        ? { buildingId: new Types.ObjectId(rest.buildingId) }
        : {}),
      organizationId: new Types.ObjectId(organizationId),
      isOrganizationWide: rest.isOrganizationWide ?? false,
      ...(galleryKey && {
        imageUrls: [this.s3Service.buildGalleryImageUrl(galleryKey)],
      }),
    });

    this.logger.log(`Resource created: ${resource.name} (${resource._id})`);
    return resource;
  }

  /**
   * Find all resources with pagination and filters
   */
  async findAll(
    organizationId: string,
    query: ResourceQueryDto,
  ): Promise<PaginatedResponseDto<ResourceDocument>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc',
      type,
      isActive,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<ResourceDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    if (type) {
      filter.type = type;
    }

    if (typeof isActive === 'boolean') {
      filter.isActive = isActive;
    } else {
      // Default to active resources only
      filter.isActive = true;
    }

    // Building filter: show items for the selected building or org-wide items
    if (query.buildingId) {
      filter.$or = [
        { buildingId: new Types.ObjectId(query.buildingId) },
        { isOrganizationWide: true },
      ];
    }

    const [resources, total] = await Promise.all([
      this.resourceModel
        .find(filter)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.resourceModel.countDocuments(filter),
    ]);

    return new PaginatedResponseDto(resources, total, page, limit);
  }

  /**
   * Find resource by ID
   */
  async findById(resourceId: string): Promise<ResourceDocument> {
    const resource = await this.resourceModel.findById(resourceId);

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    return resource;
  }

  /**
   * Update resource (board only)
   */
  async update(
    resourceId: string,
    updateDto: UpdateResourceDto,
  ): Promise<ResourceDocument> {
    const resource = await this.resourceModel.findByIdAndUpdate(
      resourceId,
      { $set: updateDto },
      { new: true, runValidators: true },
    );

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    this.logger.log(`Resource updated: ${resource.name} (${resourceId})`);
    return resource;
  }

  /**
   * Add images to resource
   */
  async addImages(
    resourceId: string,
    imageUrls: string[],
  ): Promise<ResourceDocument> {
    const resource = await this.findById(resourceId);

    // Add new images, avoiding duplicates
    const existingUrls = new Set(resource.imageUrls.map((url) => url));
    const newUrls = imageUrls.filter((url) => !existingUrls.has(url));

    resource.imageUrls = [...resource.imageUrls, ...newUrls];
    await resource.save();

    this.logger.log(`Added ${newUrls.length} images to resource ${resourceId}`);
    return resource;
  }

  /**
   * Remove image from resource
   */
  async removeImage(
    resourceId: string,
    imageUrl: string,
  ): Promise<ResourceDocument> {
    const resource = await this.findById(resourceId);

    resource.imageUrls = resource.imageUrls.filter((url) => url !== imageUrl);
    await resource.save();

    this.logger.log(`Removed image from resource ${resourceId}`);
    return resource;
  }

  /**
   * Deactivate resource
   */
  async deactivate(resourceId: string): Promise<ResourceDocument> {
    const resource = await this.resourceModel.findByIdAndUpdate(
      resourceId,
      { $set: { isActive: false } },
      { new: true },
    );

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    this.logger.log(`Resource deactivated: ${resource.name} (${resourceId})`);
    return resource;
  }

  /**
   * Get availability for a resource within a date range
   * Returns time slots with availability status
   */
  async getAvailability(
    resourceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeSlot[]> {
    const resource = await this.findById(resourceId);

    if (!resource.isActive) {
      throw new BadRequestException('Resource is not active');
    }

    // Validate date range
    if (endDate < startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    // TODO: Check existing bookings for this resource
    // For now, return all time slots as available
    // This should be implemented when bookings module is created
    const slots: TimeSlot[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();

      // Check if resource is available on this day
      const isAvailableDay =
        resource.availableDays.length === 0 ||
        resource.availableDays.includes(dayOfWeek);

      if (isAvailableDay) {
        // Create time slots for this day based on availableTimeStart and availableTimeEnd
        const [startHour, startMinute] = resource.availableTimeStart
          .split(':')
          .map(Number);
        const [endHour, endMinute] = resource.availableTimeEnd
          .split(':')
          .map(Number);

        const slotStart = new Date(currentDate);
        slotStart.setHours(startHour, startMinute, 0, 0);

        const slotEnd = new Date(currentDate);
        slotEnd.setHours(endHour, endMinute, 0, 0);

        slots.push({
          start: slotStart,
          end: slotEnd,
          available: true, // TODO: Check against existing bookings
        });
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    return slots;
  }
}


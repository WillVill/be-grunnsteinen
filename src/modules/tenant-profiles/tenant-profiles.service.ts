import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TenantProfile,
  TenantProfileDocument,
  TenantProfileStatus,
} from './schemas/tenant-profile.schema';
import { Apartment, ApartmentDocument } from '../apartments/schemas/apartment.schema';
import {
  Invitation,
  InvitationDocument,
  InvitationStatus,
} from '../invitations/schemas/invitation.schema';
import { InvitationsService } from '../invitations/invitations.service';
import { CreateTenantProfileDto, UpdateTenantProfileDto } from './dto';

@Injectable()
export class TenantProfilesService {
  private readonly logger = new Logger(TenantProfilesService.name);

  constructor(
    @InjectModel(TenantProfile.name)
    private readonly tenantProfileModel: Model<TenantProfileDocument>,
    @InjectModel(Apartment.name)
    private readonly apartmentModel: Model<ApartmentDocument>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    private readonly invitationsService: InvitationsService,
  ) {}

  async create(
    organizationId: string,
    adminId: string,
    dto: CreateTenantProfileDto,
  ): Promise<TenantProfileDocument> {
    const apartment = await this.apartmentModel.findOne({
      _id: new Types.ObjectId(dto.apartmentId),
      buildingId: new Types.ObjectId(dto.buildingId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!apartment) {
      throw new NotFoundException(`Apartment not found`);
    }

    if (dto.email) {
      const existing = await this.tenantProfileModel.findOne({
        apartmentId: new Types.ObjectId(dto.apartmentId),
        email: dto.email.toLowerCase().trim(),
      });
      if (existing) {
        throw new ConflictException('A tenant profile with this email already exists for this apartment');
      }
    }

    const profile = await this.tenantProfileModel.create({
      organizationId: new Types.ObjectId(organizationId),
      buildingId: new Types.ObjectId(dto.buildingId),
      apartmentId: new Types.ObjectId(dto.apartmentId),
      firstName: dto.firstName.trim(),
      lastName: dto.lastName?.trim(),
      email: dto.email?.toLowerCase().trim(),
      phone: dto.phone?.trim(),
      notes: dto.notes?.trim(),
      moveInDate: dto.moveInDate ? new Date(dto.moveInDate) : undefined,
      status: TenantProfileStatus.UNREGISTERED,
      addedBy: new Types.ObjectId(adminId),
    });

    this.logger.log(`Tenant profile created for ${dto.firstName} in apartment ${dto.apartmentId}`);
    return profile;
  }

  async findByApartment(
    organizationId: string,
    apartmentId: string,
  ): Promise<TenantProfileDocument[]> {
    return this.tenantProfileModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        apartmentId: new Types.ObjectId(apartmentId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByBuilding(
    organizationId: string,
    buildingId: string,
  ): Promise<TenantProfileDocument[]> {
    return this.tenantProfileModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        buildingId: new Types.ObjectId(buildingId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    organizationId: string,
    profileId: string,
    dto: UpdateTenantProfileDto,
  ): Promise<TenantProfileDocument> {
    const profile = await this.tenantProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!profile) {
      throw new NotFoundException('Tenant profile not found');
    }

    if (dto.email && dto.email !== profile.email) {
      const existing = await this.tenantProfileModel.findOne({
        apartmentId: profile.apartmentId,
        email: dto.email.toLowerCase().trim(),
        _id: { $ne: profile._id },
      });
      if (existing) {
        throw new ConflictException('A tenant profile with this email already exists for this apartment');
      }
    }

    const updateFields: Partial<TenantProfile> = {};
    if (dto.firstName !== undefined) updateFields.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) updateFields.lastName = dto.lastName.trim();
    if (dto.email !== undefined) updateFields.email = dto.email.toLowerCase().trim();
    if (dto.phone !== undefined) updateFields.phone = dto.phone.trim();
    if (dto.notes !== undefined) updateFields.notes = dto.notes.trim();
    if (dto.moveInDate !== undefined) updateFields.moveInDate = new Date(dto.moveInDate);

    Object.assign(profile, updateFields);
    return profile.save();
  }

  async delete(organizationId: string, profileId: string): Promise<void> {
    const profile = await this.tenantProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!profile) {
      throw new NotFoundException('Tenant profile not found');
    }

    // Expire linked invitation if still pending
    if (profile.status === TenantProfileStatus.INVITED && profile.invitationId) {
      await this.invitationModel.updateOne(
        { _id: profile.invitationId, status: InvitationStatus.PENDING },
        { $set: { status: InvitationStatus.EXPIRED } },
      );
      this.logger.log(`Expired invitation ${profile.invitationId} on tenant profile deletion`);
    }

    await this.tenantProfileModel.deleteOne({ _id: profile._id });
    this.logger.log(`Tenant profile ${profileId} deleted`);
  }

  async sendInvite(
    organizationId: string,
    adminId: string,
    profileId: string,
  ): Promise<TenantProfileDocument> {
    const profile = await this.tenantProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!profile) {
      throw new NotFoundException('Tenant profile not found');
    }
    if (!profile.email) {
      throw new BadRequestException('Tenant profile has no email address — add one before sending an invitation');
    }
    if (profile.status === TenantProfileStatus.REGISTERED) {
      throw new BadRequestException('Leietaker er allerede registrert');
    }

    const invitation = await this.invitationsService.create(organizationId, adminId, {
      email: profile.email,
      buildingId: profile.buildingId.toString(),
      apartmentId: profile.apartmentId.toString(),
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
    });

    profile.invitationId = invitation._id as Types.ObjectId;
    profile.status = TenantProfileStatus.INVITED;
    return profile.save();
  }

  async markRegistered(invitationId: string, userId: string): Promise<void> {
    const result = await this.tenantProfileModel.updateOne(
      { invitationId: new Types.ObjectId(invitationId) },
      {
        $set: {
          status: TenantProfileStatus.REGISTERED,
          userId: new Types.ObjectId(userId),
        },
      },
    );
    if (result.matchedCount > 0) {
      this.logger.log(`TenantProfile marked as registered for invitation ${invitationId}`);
    }
  }
}

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Invitation, InvitationDocument, InvitationStatus } from './schemas/invitation.schema';
import { Building, BuildingDocument } from '../buildings/schemas/building.schema';
import { Organization, OrganizationDocument } from '../organizations/schemas/organization.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Apartment, ApartmentDocument } from '../apartments/schemas/apartment.schema';
import { CreateInvitationDto } from './dto';
import { EmailService } from '../../shared/services/email.service';

const TOKEN_BYTES = 32;
const EXPIRY_DAYS = 7;

export interface ValidateInvitationResult {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  buildingId: string;
  buildingName: string;
  email: string;
  unitNumber?: string;
  apartmentId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(Building.name)
    private readonly buildingModel: Model<BuildingDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Apartment.name)
    private readonly apartmentModel: Model<ApartmentDocument>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationDocument> {
    const building = await this.buildingModel.findOne({
      _id: new Types.ObjectId(dto.buildingId),
      organizationId: new Types.ObjectId(organizationId),
    });
    if (!building) {
      throw new NotFoundException(`Building with ID "${dto.buildingId}" not found`);
    }

    const email = dto.email.toLowerCase().trim();
    const existingUser = await this.userModel.findOne({
      organizationId: new Types.ObjectId(organizationId),
      email,
    });
    if (existingUser) {
      throw new ConflictException('A user with this email is already in the organization');
    }

    const existingPending = await this.invitationModel.findOne({
      email,
      buildingId: new Types.ObjectId(dto.buildingId),
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });
    if (existingPending) {
      throw new ConflictException('A pending invitation for this email and building already exists');
    }

    if (dto.apartmentId) {
      const apartment = await this.apartmentModel.findOne({
        _id: new Types.ObjectId(dto.apartmentId),
        buildingId: new Types.ObjectId(dto.buildingId),
        organizationId: new Types.ObjectId(organizationId),
      });
      if (!apartment) {
        throw new NotFoundException(`Apartment with ID "${dto.apartmentId}" not found`);
      }
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.invitationModel.create({
      email,
      buildingId: new Types.ObjectId(dto.buildingId),
      organizationId: new Types.ObjectId(organizationId),
      unitNumber: dto.unitNumber?.trim(),
      apartmentId: dto.apartmentId ? new Types.ObjectId(dto.apartmentId) : undefined,
      firstName: dto.firstName?.trim(),
      lastName: dto.lastName?.trim(),
      phone: dto.phone?.trim(),
      token,
      expiresAt,
      createdBy: new Types.ObjectId(userId),
      status: InvitationStatus.PENDING,
    });

    const frontendUrl = this.configService.get<string>('frontendUrl') || '';
    const inviteLink = `${frontendUrl}/register?invite=${token}`;
    const organization = await this.organizationModel.findById(organizationId);

    this.emailService
      .sendInviteEmail(email, organization?.name || 'Organization', building.name, inviteLink)
      .catch((err) => this.logger.error(`Failed to send invite email to ${email}`, err));

    this.logger.log(`Invitation created for ${email} to building ${building.name}`);
    return invitation;
  }

  async validate(token: string): Promise<ValidateInvitationResult> {
    const invitation = await this.invitationModel.findOne({ token });
    if (!invitation) {
      throw new BadRequestException('Invalid or expired invitation');
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation has already been used');
    }
    if (invitation.expiresAt < new Date()) {
      await this.invitationModel.updateOne(
        { _id: invitation._id },
        { $set: { status: InvitationStatus.EXPIRED } },
      );
      throw new BadRequestException('This invitation has expired');
    }

    const [organization, building] = await Promise.all([
      this.organizationModel.findById(invitation.organizationId),
      this.buildingModel.findById(invitation.buildingId),
    ]);

    return {
      invitationId: invitation._id.toString(),
      organizationId: invitation.organizationId.toString(),
      organizationName: organization?.name ?? '',
      buildingId: invitation.buildingId.toString(),
      buildingName: building?.name ?? '',
      email: invitation.email,
      unitNumber: invitation.unitNumber,
      apartmentId: invitation.apartmentId?.toString(),
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      phone: invitation.phone,
    };
  }

  async markAccepted(token: string): Promise<void> {
    const result = await this.invitationModel.updateOne(
      { token, status: InvitationStatus.PENDING },
      { $set: { status: InvitationStatus.ACCEPTED } },
    );
    if (result.matchedCount === 0) {
      this.logger.warn(`Invitation markAccepted: no pending invitation found for token`);
    }
  }

  async findByBuilding(organizationId: string, buildingId: string): Promise<InvitationDocument[]> {
    return this.invitationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        buildingId: new Types.ObjectId(buildingId),
        status: InvitationStatus.PENDING,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}

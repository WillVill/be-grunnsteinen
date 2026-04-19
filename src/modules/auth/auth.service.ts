import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { StringValue } from 'ms';
import * as crypto from 'crypto';
import { Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Organization, OrganizationDocument } from '../organizations/schemas/organization.schema';
import { Apartment, ApartmentDocument } from '../apartments/schemas/apartment.schema';
import { EmailService } from '../../shared/services/email.service';
import { InvitationsService } from '../invitations/invitations.service';
import { TenantProfilesService } from '../tenant-profiles/tenant-profiles.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CompleteSetupDto,
} from './dto';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
  buildingIds: string[];
  primaryBuildingId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: Partial<User>;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(Apartment.name)
    private readonly apartmentModel: Model<ApartmentDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly invitationsService: InvitationsService,
    private readonly tenantProfilesService: TenantProfilesService,
  ) {}

  /**
   * Register a new user
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, name, phone, organizationCode, unitNumber, building, inviteToken } =
      registerDto;

    let organization: OrganizationDocument | null;
    let buildingId: Types.ObjectId | undefined;
    const emailLower = email.toLowerCase();

    let inviteUnitNumber: string | undefined;
    let inviteApartmentId: string | undefined;
    let inviteFirstName: string | undefined;
    let inviteLastName: string | undefined;
    let invitePhone: string | undefined;
    let inviteInvitationId: string | undefined;
    if (inviteToken) {
      const invite = await this.invitationsService.validate(inviteToken);
      if (invite.email.toLowerCase() !== emailLower) {
        throw new BadRequestException('Email must match the invited email address');
      }
      organization = await this.organizationModel.findById(invite.organizationId);
      if (!organization || !organization.isActive) {
        throw new BadRequestException('Invalid invitation');
      }
      buildingId = new Types.ObjectId(invite.buildingId);
      inviteUnitNumber = invite.unitNumber;
      inviteApartmentId = invite.apartmentId;
      inviteFirstName = invite.firstName;
      inviteLastName = invite.lastName;
      invitePhone = invite.phone;
      inviteInvitationId = invite.invitationId;
    } else {
      if (!organizationCode) {
        throw new BadRequestException('Organization code is required');
      }
      organization = await this.organizationModel.findOne({
        code: organizationCode,
        isActive: true,
      });
      if (!organization) {
        throw new BadRequestException('Invalid organization code');
      }
    }

    const existingUser = await this.userModel.findOne({ email: emailLower });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const inviteFullName = [inviteFirstName, inviteLastName].filter(Boolean).join(' ');
    const userPayload: Record<string, unknown> = {
      email: emailLower,
      password,
      name: name || inviteFullName || emailLower,
      phone: phone || invitePhone,
      organizationId: organization._id,
      unitNumber: unitNumber || inviteUnitNumber || '-',
      building,
    };

    if (buildingId) {
      userPayload.buildingIds = [buildingId];
      userPayload.primaryBuildingId = buildingId;
    }

    const user = await this.userModel.create(userPayload);

    if (inviteToken) {
      await this.invitationsService.markAccepted(inviteToken);

      // Sync TenantProfile lifecycle if one exists for this invitation
      if (inviteInvitationId) {
        await this.tenantProfilesService.markRegistered(inviteInvitationId, user._id.toString());
      }

      if (inviteApartmentId) {
        try {
          await this.apartmentModel.findOneAndUpdate(
            {
              _id: new Types.ObjectId(inviteApartmentId),
              organizationId: organization._id,
            },
            { $addToSet: { tenantIds: user._id } },
          );
          this.logger.log(`Auto-assigned user ${user.email} as tenant of apartment ${inviteApartmentId}`);
        } catch (err) {
          this.logger.error(`Failed to auto-assign tenant to apartment ${inviteApartmentId}`, err);
        }
      }
    }

    const tokens = this.generateTokens(user);

    this.emailService
      .sendWelcomeEmail(
        {
          _id: user._id.toString(),
          email: user.email,
          firstName: user.name.split(' ')[0],
          lastName: user.name.split(' ').slice(1).join(' '),
        },
        {
          _id: organization._id.toString(),
          name: organization.name,
        },
      )
      .catch((error) => {
        this.logger.error('Failed to send welcome email', error);
      });

    this.logger.log(`User registered: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /**
   * Login user
   */
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    // Find user with password
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password');

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      const pending = await this.userModel
        .findById(user._id)
        .select('+setupTokenExpires');
      if (pending?.setupTokenExpires) {
        throw new UnauthorizedException({
          code: 'ACCOUNT_PENDING_SETUP',
          message:
            'Din konto er ikke aktivert. Sjekk e-posten din for oppsettslink.',
        });
      }
      throw new UnauthorizedException('Account is deactivated');
    }

    // Validate password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Generate tokens
    const tokens = this.generateTokens(user);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify<TokenPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      const user = await this.userModel.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.generateTokens(user);
    } catch (error) {
      this.logger.warn(`Invalid refresh token attempt`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;

    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordResetToken +passwordResetExpires');

    // Always return success to prevent email enumeration
    if (!user) {
      this.logger.log(`Password reset requested for non-existent email: ${email}`);
      return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set token and expiry (1 hour)
    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    // Send reset email
    try {
      await this.emailService.sendPasswordResetEmail(
        {
          _id: user._id.toString(),
          email: user.email,
          firstName: user.name.split(' ')[0],
          lastName: user.name.split(' ').slice(1).join(' '),
        },
        resetToken,
      );
      this.logger.log(`Password reset email sent to: ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to: ${email}`, error);
      // Don't throw - user shouldn't know if email send failed
    }
  }

  /**
   * Reset password using token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, password } = resetPasswordDto;

    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await this.userModel
      .findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: new Date() },
      })
      .select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password and clear reset fields
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    this.logger.log(`Password reset successful for: ${user.email}`);

    // Send confirmation email (async)
    this.emailService
      .sendEmail(
        user.email,
        'Password Changed Successfully',
        `
          <h1>Password Changed</h1>
          <p>Hi ${user.name.split(' ')[0]},</p>
          <p>Your password has been successfully changed.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
        `,
      )
      .catch((error) => {
        this.logger.error('Failed to send password change confirmation', error);
      });
  }

  /**
   * Validate a pending-admin setup token without consuming it.
   * Returns the email, role, and organization name so the setup page
   * can pre-fill read-only fields.
   */
  async validateSetupToken(
    token: string,
  ): Promise<{ email: string; role: string; organizationName: string }> {
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await this.userModel
      .findOne({
        setupToken: hashedToken,
        setupTokenExpires: { $gt: new Date() },
      })
      .select('+setupToken +setupTokenExpires');

    if (!user) {
      throw new BadRequestException('Invalid or expired setup link');
    }

    const organization = await this.organizationModel.findById(
      user.organizationId,
    );

    return {
      email: user.email,
      role: user.role,
      organizationName: organization?.name || '',
    };
  }

  /**
   * Complete the admin setup: consume the token, set name/phone/password,
   * activate the user, and return login tokens for auto-login.
   */
  async completeSetup(dto: CompleteSetupDto): Promise<AuthResponse> {
    const hashedToken = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const user = await this.userModel
      .findOne({
        setupToken: hashedToken,
        setupTokenExpires: { $gt: new Date() },
      })
      .select('+setupToken +setupTokenExpires');

    if (!user) {
      throw new BadRequestException('Invalid or expired setup link');
    }

    user.name = dto.name;
    user.phone = dto.phone;
    user.password = dto.password; // bcrypt pre-save hook hashes it
    user.isActive = true;
    user.lastLoginAt = new Date();
    user.setupToken = undefined;
    user.setupTokenExpires = undefined;
    await user.save();

    this.logger.log(`Admin setup completed: ${user.email}`);

    const tokens = this.generateTokens(user);
    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const { currentPassword, newPassword } = changePasswordDto;

    const user = await this.userModel.findById(userId).select('+password');
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Update password
    user.password = newPassword;
    await user.save();

    this.logger.log(`Password changed for user: ${user.email}`);
  }

  /**
   * Validate user for Passport local strategy
   */
  async validateUser(email: string, password: string): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password');

    if (!user || !user.isActive) {
      return null;
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  /**
   * Generate access and refresh tokens
   */
  generateTokens(user: UserDocument): AuthTokens {
    const payload: TokenPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      organizationId: user.organizationId.toString(),
      buildingIds: user.buildingIds?.map((id) => id.toString()) || [],
      primaryBuildingId: user.primaryBuildingId?.toString(),
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: (this.configService.get<string>('jwt.expiration') || '7d') as StringValue,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: (this.configService.get<string>('jwt.refreshExpiration') || '30d') as StringValue,
    });

    return { accessToken, refreshToken };
  }

  /**
   * Get user profile by userId
   */
  async getUserProfile(userId: string): Promise<Partial<User>> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return this.sanitizeUser(user);
  }

  /**
   * Remove sensitive fields from user object
   */
  private sanitizeUser(user: UserDocument): Partial<User> {
    const userObject = user.toObject() as Record<string, unknown>;
    delete userObject.password;
    delete userObject.passwordResetToken;
    delete userObject.passwordResetExpires;
    delete userObject.setupToken;
    delete userObject.setupTokenExpires;
    return userObject as Partial<User>;
  }
}


import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantProfilesService } from './tenant-profiles.service';
import { TenantProfilesController } from './tenant-profiles.controller';
import { TenantProfile, TenantProfileSchema } from './schemas/tenant-profile.schema';
import { Apartment, ApartmentSchema } from '../apartments/schemas/apartment.schema';
import { Invitation, InvitationSchema } from '../invitations/schemas/invitation.schema';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TenantProfile.name, schema: TenantProfileSchema },
      { name: Apartment.name, schema: ApartmentSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    InvitationsModule,
  ],
  controllers: [TenantProfilesController],
  providers: [TenantProfilesService],
  exports: [TenantProfilesService],
})
export class TenantProfilesModule {}

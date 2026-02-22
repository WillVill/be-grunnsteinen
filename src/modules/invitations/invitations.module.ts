import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { Building, BuildingSchema } from '../buildings/schemas/building.schema';
import { Organization, OrganizationSchema } from '../organizations/schemas/organization.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { EmailModule } from '../../shared/services/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: Building.name, schema: BuildingSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}

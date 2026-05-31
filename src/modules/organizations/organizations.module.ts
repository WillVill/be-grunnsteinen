import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from './schemas/organization.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Building, BuildingSchema } from '../buildings/schemas/building.schema';
import { Concept, ConceptSchema } from '../concepts/schemas/concept.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Post, PostSchema } from '../posts/schemas/post.schema';
import { HelpRequest, HelpRequestSchema } from '../sharing/schemas/help-request.schema';
import { TenantProfile, TenantProfileSchema } from '../tenant-profiles/schemas/tenant-profile.schema';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { S3Module } from '../../shared/services/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: Building.name, schema: BuildingSchema },
      { name: Concept.name, schema: ConceptSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Event.name, schema: EventSchema },
      { name: Post.name, schema: PostSchema },
      { name: HelpRequest.name, schema: HelpRequestSchema },
      { name: TenantProfile.name, schema: TenantProfileSchema },
    ]),
    S3Module,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [MongooseModule, OrganizationsService],
})
export class OrganizationsModule {}


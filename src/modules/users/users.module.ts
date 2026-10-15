import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Organization, OrganizationSchema } from '../organizations/schemas/organization.schema';
import { Building, BuildingSchema } from '../buildings/schemas/building.schema';
import { Post, PostSchema } from '../posts/schemas/post.schema';
import { Comment, CommentSchema } from '../posts/schemas/comment.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { SharedItem, SharedItemSchema } from '../sharing/schemas/shared-item.schema';
import { HelpRequest, HelpRequestSchema } from '../sharing/schemas/help-request.schema';
import { Conversation, ConversationSchema } from '../messages/schemas/conversation.schema';
import { Message, MessageSchema } from '../messages/schemas/message.schema';
import { Invitation, InvitationSchema } from '../invitations/schemas/invitation.schema';
import { TenantProfile, TenantProfileSchema } from '../tenant-profiles/schemas/tenant-profile.schema';
import { Apartment, ApartmentSchema } from '../apartments/schemas/apartment.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AccountDeletionService } from './account-deletion.service';
import { S3Module } from '../../shared/services/s3.module';
import { EmailModule } from '../../shared/services/email.module';
import { NotificationModule } from '../../shared/services/notification.module';
import { EventsModule } from '../events/events.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Building.name, schema: BuildingSchema },
      // Models the account-deletion cascade reaches into.
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Event.name, schema: EventSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Group.name, schema: GroupSchema },
      { name: SharedItem.name, schema: SharedItemSchema },
      { name: HelpRequest.name, schema: HelpRequestSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: TenantProfile.name, schema: TenantProfileSchema },
      { name: Apartment.name, schema: ApartmentSchema },
    ]),
    S3Module,
    EmailModule,
    NotificationModule,
    EventsModule,
    BookingsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService],
  exports: [MongooseModule, UsersService],
})
export class UsersModule {}

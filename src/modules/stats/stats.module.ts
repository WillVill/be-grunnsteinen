import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyStat, DailyStatSchema } from './schemas/daily-stat.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Post, PostSchema } from '../posts/schemas/post.schema';
import { Comment, CommentSchema } from '../posts/schemas/comment.schema';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { HelpRequest, HelpRequestSchema } from '../sharing/schemas/help-request.schema';
import { Message, MessageSchema } from '../messages/schemas/message.schema';
import { Conversation, ConversationSchema } from '../messages/schemas/conversation.schema';
import { Building, BuildingSchema } from '../buildings/schemas/building.schema';
import { Organization, OrganizationSchema } from '../organizations/schemas/organization.schema';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

// Note: ScheduleModule.forRoot() is already registered in TasksModule — do not
// register it again here. @Cron decorators on StatsService still work globally.

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyStat.name, schema: DailyStatSchema },
      { name: User.name, schema: UserSchema },
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Event.name, schema: EventSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: HelpRequest.name, schema: HelpRequestSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Building.name, schema: BuildingSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}

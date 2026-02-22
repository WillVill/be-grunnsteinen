import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { Event, EventSchema } from '../events/schemas/event.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import {
  HelpRequest,
  HelpRequestSchema,
} from '../sharing/schemas/help-request.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Post, PostSchema } from '../posts/schemas/post.schema';
import { Comment, CommentSchema } from '../posts/schemas/comment.schema';
import { NotificationModule } from '../../shared/services/notification.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: HelpRequest.name, schema: HelpRequestSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
    NotificationModule,
    EventsModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}


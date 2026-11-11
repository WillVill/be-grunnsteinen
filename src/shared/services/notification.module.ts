import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationService } from './notification.service';
import { Notification, NotificationSchema } from './notification.schema';
import { ExpoPushService } from './expo-push.service';
import { PushReceiptsService } from './push-receipts.service';
import { PushTicket, PushTicketSchema } from './push-ticket.schema';
import { EmailModule } from './email.module';
import { User, UserSchema } from '../../modules/users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: PushTicket.name, schema: PushTicketSchema },
    ]),
    EmailModule,
  ],
  providers: [NotificationService, ExpoPushService, PushReceiptsService],
  exports: [NotificationService, ExpoPushService],
})
export class NotificationModule {}


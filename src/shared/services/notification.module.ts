import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationService } from './notification.service';
import { Notification, NotificationSchema } from './notification.schema';
import { EmailModule } from './email.module';
import { User, UserSchema } from '../../modules/users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}


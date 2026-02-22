import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HelpRequest, HelpRequestSchema } from './schemas/help-request.schema';
import { SharedItem, SharedItemSchema } from './schemas/shared-item.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';
import { NotificationModule } from '../../shared/services/notification.module';
import { EmailModule } from '../../shared/services/email.module';
import { S3Module } from '../../shared/services/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HelpRequest.name, schema: HelpRequestSchema },
      { name: SharedItem.name, schema: SharedItemSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationModule,
    EmailModule,
    S3Module,
  ],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { NotificationModule } from '../../shared/services/notification.module';
import { EmailModule } from '../../shared/services/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationModule,
    EmailModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Group, GroupSchema } from './schemas/group.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { S3Module } from '../../shared/services/s3.module';
import { NotificationModule } from '../../shared/services/notification.module';
import { ConceptsModule } from '../concepts/concepts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: User.name, schema: UserSchema },
    ]),
    S3Module,
    NotificationModule,
    ConceptsModule,
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from './schemas/post.schema';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Group, GroupSchema } from '../groups/schemas/group.schema';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { NotificationModule } from '../../shared/services/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: User.name, schema: UserSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
    NotificationModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}


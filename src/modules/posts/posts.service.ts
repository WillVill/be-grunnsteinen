import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, QueryFilter } from 'mongoose';
import { Post, PostDocument } from './schemas/post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  CreatePostDto,
  UpdatePostDto,
  CreateCommentDto,
  PostQueryDto,
} from './dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotificationService, NotificationType } from '../../shared/services/notification.service';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create a new post
   */
  async create(
    userId: string,
    organizationId: string,
    createDto: CreatePostDto,
  ): Promise<PostDocument> {
    // Check if user is board member
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isFromBoard = ['board', 'admin'].includes(user.role);

    if (!createDto.isOrganizationWide && !createDto.buildingId) {
      throw new BadRequestException(
        'Either a building must be selected or the post must be marked as organization-wide.',
      );
    }

    const postData: Record<string, unknown> = {
      title: createDto.title,
      content: createDto.content,
      category: createDto.category,
      authorId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      isFromBoard,
      isOrganizationWide: createDto.isOrganizationWide ?? false,
    };
    if (createDto.buildingId) {
      postData.buildingId = new Types.ObjectId(createDto.buildingId);
    }
    if (createDto.groupId) {
      postData.groupId = new Types.ObjectId(createDto.groupId);
    }
    const post = await this.postModel.create(postData);

    this.logger.log(`Post created: ${post._id} by user ${userId}`);

    // Notify group or building members about new post (POST_CREATED)
    const recipientIds: string[] = [];
    if (post.groupId) {
      const group = await this.groupModel.findById(post.groupId).exec();
      if (group?.members?.length) {
        const authorIdStr = userId.toString();
        const memberIds = group.members
          .filter((id) => id.toString() !== authorIdStr)
          .map((id) => id.toString());
        recipientIds.push(...memberIds);
      }
    }
    if (recipientIds.length > 0) {
      const preview = (post.title || post.content).slice(0, 80);
      const title = 'New post';
      const message = `${user.name} posted: ${preview}${(post.title || post.content).length > 80 ? '…' : ''}`;
      await this.notificationService
        .createBulkNotifications(
          recipientIds,
          NotificationType.POST_CREATED,
          title,
          message,
          `/posts/${post._id}`,
          false,
        )
        .catch((err) => this.logger.warn(`Failed to send post notifications: ${err.message}`));
    }

    return this.postModel
      .findById(post._id)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .populate('groupId', 'name')
      .exec();
  }

  /**
   * Find all posts with pagination and filters
   */
  async findAll(
    organizationId: string,
    query: PostQueryDto,
    userId?: string,
  ): Promise<PaginatedResponseDto<any>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      category,
      authorId,
      isPinned,
      fromBoard,
      groupId,
      excludeGroupPosts,
    } = query;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter: QueryFilter<PostDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    if (category) {
      filter.category = category;
    }

    if (authorId) {
      filter.authorId = new Types.ObjectId(authorId);
    }

    if (typeof isPinned === 'boolean') {
      filter.isPinned = isPinned;
    }

    if (typeof fromBoard === 'boolean') {
      filter.isFromBoard = fromBoard;
    }

    if (groupId) {
      filter.groupId = new Types.ObjectId(groupId);
    }

    if (excludeGroupPosts === true) {
      filter.$or = [{ groupId: { $exists: false } }, { groupId: null }];
    }

    // Building filter: show items for the selected building or org-wide items
    if (query.buildingId) {
      const buildingCondition = {
        $or: [
          { buildingId: new Types.ObjectId(query.buildingId) },
          { isOrganizationWide: true },
        ],
      };
      // Combine with existing filter using $and to avoid overwriting $or
      if (filter.$or) {
        const existingOr = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: existingOr }, buildingCondition];
      } else {
        filter.$or = buildingCondition.$or;
      }
    }

    // Build sort: pinned posts first, then by specified field
    const sort: Record<string, 1 | -1> = {};
    if (sortBy === 'createdAt' && !filter.isPinned) {
      // If not filtering by pinned, show pinned first
      sort.isPinned = -1;
    }
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [posts, total] = await Promise.all([
      this.postModel
        .find(filter)
        .populate('authorId', 'name avatarUrl avatarColor role')
        .populate('groupId', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.postModel.countDocuments(filter),
    ]);

    // Add isLiked field to each post
    const postsWithLikeStatus = posts.map(post => ({
      ...post,
      id: post._id.toString(),
      isLiked: userId ? post.likes.some((likeId: any) => likeId.toString() === userId) : false,
      likes: post.likes.map((likeId: any) => likeId.toString()),
    }));

    return new PaginatedResponseDto(postsWithLikeStatus, total, page, limit);
  }

  /**
   * Find post by ID (internal use - returns Mongoose document)
   */
  private async findPostDocument(postId: string): Promise<PostDocument> {
    const post = await this.postModel
      .findById(postId)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .exec();

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  /**
   * Find post by ID with like status (public API)
   */
  async findById(postId: string, userId?: string): Promise<any> {
    const post = await this.postModel
      .findById(postId)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .populate('groupId', 'name')
      .lean()
      .exec();

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Fetch comments for this post
    const comments = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .populate('authorId', 'name avatarUrl avatarColor role')
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    // Convert comment IDs and add to response
    const formattedComments = comments.map(comment => ({
      ...comment,
      id: comment._id.toString(),
      parentCommentId: comment.parentCommentId
        ? comment.parentCommentId.toString()
        : null,
    }));

    // Add isLiked field and convert likes to strings
    return {
      ...post,
      id: post._id.toString(),
      isLiked: userId ? post.likes.some((likeId: any) => likeId.toString() === userId) : false,
      likes: post.likes.map((likeId: any) => likeId.toString()),
      comments: formattedComments,
    };
  }

  /**
   * Update post
   */
  async update(
    postId: string,
    userId: string,
    updateDto: UpdatePostDto,
  ): Promise<PostDocument> {
    const post = await this.findPostDocument(postId);

    // Verify user is author or board member
    // Note: findPostDocument populates authorId, so use _id for comparison
    const user = await this.userModel.findById(userId);
    const authorIdStr = ((post.authorId as any)?._id ?? post.authorId).toString();
    const isAuthor = authorIdStr === userId;
    const isBoard = user && ['board', 'admin'].includes(user.role);

    if (!isAuthor && !isBoard) {
      throw new ForbiddenException('Only the author or board members can update this post');
    }

    const updatedPost = await this.postModel
      .findByIdAndUpdate(postId, { $set: updateDto }, { new: true })
      .populate('authorId', 'name avatarUrl avatarColor role')
      .exec();

    this.logger.log(`Post updated: ${postId}`);
    return updatedPost;
  }

  /**
   * Delete post and its comments
   */
  async delete(postId: string, userId: string): Promise<void> {
    const post = await this.findPostDocument(postId);

    // Verify user is author or board member
    // Note: findPostDocument populates authorId, so use _id for comparison
    const user = await this.userModel.findById(userId);
    const authorIdStr = ((post.authorId as any)?._id ?? post.authorId).toString();
    const isAuthor = authorIdStr === userId;
    const isBoard = user && ['board', 'admin'].includes(user.role);

    if (!isAuthor && !isBoard) {
      throw new ForbiddenException('Only the author or board members can delete this post');
    }

    // Delete all comments
    await this.commentModel.deleteMany({ postId: new Types.ObjectId(postId) });

    // Delete post
    await this.postModel.deleteOne({ _id: postId });

    this.logger.log(`Post deleted: ${postId}`);
  }

  /**
   * Toggle pin status (board only)
   */
  async togglePin(postId: string, userId: string): Promise<PostDocument> {
    const post = await this.findPostDocument(postId);

    // Verify user is board member
    const user = await this.userModel.findById(userId);
    if (!user || !['board', 'admin'].includes(user.role)) {
      throw new ForbiddenException('Only board members can pin/unpin posts');
    }

    post.isPinned = !post.isPinned;
    await post.save();

    return this.postModel
      .findById(postId)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .exec();
  }

  /**
   * Toggle like on post
   */
  async toggleLike(postId: string, userId: string): Promise<any> {
    const post = await this.findPostDocument(postId);
    const userIdObj = new Types.ObjectId(userId);

    const isLiked = post.likes.some(
      (likeId) => likeId.toString() === userId,
    );

    if (isLiked) {
      // Remove like
      post.likes = post.likes.filter(
        (likeId) => likeId.toString() !== userId,
      );
      post.likesCount = Math.max(0, post.likesCount - 1);
    } else {
      // Add like
      post.likes.push(userIdObj);
      post.likesCount = post.likes.length;
    }

    await post.save();

    const updatedPost = await this.postModel
      .findById(postId)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .lean()
      .exec();

    // Add isLiked field and convert likes to strings
    return {
      ...updatedPost,
      id: updatedPost._id.toString(),
      isLiked: updatedPost.likes.some((likeId: any) => likeId.toString() === userId),
      likes: updatedPost.likes.map((likeId: any) => likeId.toString()),
    };
  }

  /**
   * Add comment to post
   */
  async addComment(
    postId: string,
    userId: string,
    createCommentDto: CreateCommentDto,
  ): Promise<CommentDocument> {
    const post = await this.findPostDocument(postId);

    let parentCommentId: Types.ObjectId | null = null;
    if (createCommentDto.parentCommentId) {
      const parent = await this.commentModel.findById(createCommentDto.parentCommentId);
      if (!parent) {
        throw new NotFoundException('Parent comment not found');
      }
      if (parent.postId.toString() !== postId) {
        throw new BadRequestException('Parent comment does not belong to this post');
      }
      if (parent.parentCommentId) {
        throw new BadRequestException('Replies can only target top-level comments');
      }
      parentCommentId = parent._id as Types.ObjectId;
    }

    // Create comment
    const comment = await this.commentModel.create({
      postId: new Types.ObjectId(postId),
      authorId: new Types.ObjectId(userId),
      content: createCommentDto.content,
      parentCommentId,
    });

    // Increment comments count
    post.commentsCount += 1;
    await post.save();

    // Notify post author if not the same user
    // Note: findPostDocument populates authorId, so use _id for comparison
    const postAuthorIdStr = ((post.authorId as any)?._id ?? post.authorId).toString();
    if (postAuthorIdStr !== userId) {
      const commentAuthor = await this.userModel.findById(userId);
      if (commentAuthor) {
        await this.notificationService.createNotification(
          postAuthorIdStr,
          NotificationType.POST_COMMENT,
          'New comment on your post',
          `${commentAuthor.name} commented on your post`,
          `/posts/${postId}`,
          true, // Send email
          {
            _id: commentAuthor._id.toString(),
            email: commentAuthor.email,
            firstName: commentAuthor.name.split(' ')[0],
            lastName: commentAuthor.name.split(' ').slice(1).join(' '),
          },
        ).catch((error) => {
          this.logger.error('Failed to send comment notification', error);
        });
      }
    }

    this.logger.log(`Comment added to post: ${postId}`);

    return this.commentModel
      .findById(comment._id)
      .populate('authorId', 'name avatarUrl avatarColor role')
      .exec();
  }

  /**
   * Delete comment
   */
  async deleteComment(commentId: string, userId: string): Promise<void> {
    const comment = await this.commentModel.findById(commentId);

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Verify user is comment author or board member
    const user = await this.userModel.findById(userId);
    const isAuthor = comment.authorId.toString() === userId;
    const isBoard = user && ['board', 'admin'].includes(user.role);

    if (!isAuthor && !isBoard) {
      throw new ForbiddenException(
        'Only the author or board members can delete this comment',
      );
    }

    // If this is a top-level comment, cascade-delete its replies too
    let repliesDeletedCount = 0;
    if (!comment.parentCommentId) {
      const repliesResult = await this.commentModel.deleteMany({
        parentCommentId: new Types.ObjectId(commentId),
      });
      repliesDeletedCount = repliesResult.deletedCount ?? 0;
    }

    // Find post and decrement comments count by 1 + deleted replies
    const post = await this.postModel.findById(comment.postId);
    if (post) {
      post.commentsCount = Math.max(0, post.commentsCount - 1 - repliesDeletedCount);
      await post.save();
    }

    // Delete comment
    await this.commentModel.deleteOne({ _id: commentId });

    this.logger.log(`Comment deleted: ${commentId} (cascaded ${repliesDeletedCount} replies)`);
  }

  /**
   * Get comments for a post
   */
  async getComments(
    postId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<CommentDocument>> {
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      this.commentModel
        .find({ postId: new Types.ObjectId(postId) })
        .populate('authorId', 'name avatarUrl avatarColor role')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.commentModel.countDocuments({ postId: new Types.ObjectId(postId) }),
    ]);

    return new PaginatedResponseDto(comments, total, page, limit);
  }
}


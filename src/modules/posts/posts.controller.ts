import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PostsService } from './posts.service';
import {
  CreatePostDto,
  UpdatePostDto,
  CreateCommentDto,
  PostQueryDto,
  PostResponseDto,
  CommentResponseDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UseGuards } from '@nestjs/common';

@ApiTags('Posts')
@ApiBearerAuth('JWT-auth')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({
    status: 201,
    description: 'Post created successfully',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.create(
      user.userId,
      user.organizationId,
      createPostDto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated posts in organization' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of posts',
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: PostQueryDto,
  ) {
    return this.postsService.findAll(user.organizationId, query, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID with comments' })
  @ApiResponse({
    status: 200,
    description: 'Post details',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async findOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.postsService.findById(id, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update post (author or board only)' })
  @ApiResponse({
    status: 200,
    description: 'Post updated',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(id, userId, updatePostDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete post (author or board only)' })
  @ApiResponse({
    status: 204,
    description: 'Post deleted successfully',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async delete(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    await this.postsService.delete(id, userId);
  }

  @Post(':id/pin')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Toggle pin status (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Pin status toggled',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async togglePin(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.postsService.togglePin(id, userId);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Toggle like on post' })
  @ApiResponse({
    status: 200,
    description: 'Like status toggled',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async toggleLike(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.postsService.toggleLike(id, userId);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add comment to post' })
  @ApiResponse({
    status: 201,
    description: 'Comment created',
    type: CommentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async addComment(
    @CurrentUser('userId') userId: string,
    @Param('id') postId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.postsService.addComment(postId, userId, createCommentDto);
  }

  @Delete(':postId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete comment (author or board only)' })
  @ApiResponse({
    status: 204,
    description: 'Comment deleted successfully',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async deleteComment(
    @CurrentUser('userId') userId: string,
    @Param('commentId') commentId: string,
  ) {
    await this.postsService.deleteComment(commentId, userId);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get comments for a post' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of comments',
  })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getComments(
    @Param('id') postId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.postsService.getComments(postId, page, limit);
  }
}


import {
  Controller,
  Get,
  Post,
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
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import {
  CreateMessageDto,
  ConversationQueryDto,
  MessageQueryDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags('Messages')
@ApiBearerAuth('JWT-auth')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message',
    description: 'Send a message to a user. Creates a new conversation if one does not exist.',
  })
  @ApiBody({ type: CreateMessageDto })
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Conversation or recipient not found' })
  async sendMessage(
    @CurrentUser() user: CurrentUserData,
    @Body() createMessageDto: CreateMessageDto,
  ) {
    return this.messagesService.sendMessage(
      user.userId,
      user.organizationId,
      createMessageDto,
    );
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'Get paginated conversations',
    description: 'Get paginated list of conversations for the current user.',
  })
  @ApiQuery({ name: 'query', type: ConversationQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of conversations',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getConversations(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ConversationQueryDto,
  ) {
    return this.messagesService.getConversations(
      user.userId,
      user.organizationId,
      query,
    );
  }

  @Get('conversations/:id')
  @ApiOperation({
    summary: 'Get conversation by ID with recent messages',
    description: 'Get conversation details along with recent messages.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Conversation details with recent messages',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Conversation not found' })
  async getConversationById(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.messagesService.getConversationById(id, user.userId);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'Get paginated messages in a conversation',
    description: 'Get paginated list of messages in a conversation. Messages are automatically marked as read.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', example: '507f1f77bcf86cd799439011' })
  @ApiQuery({ name: 'query', type: MessageQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of messages',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Conversation not found' })
  async getMessages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.messagesService.getMessages(id, user.userId, {
      ...query,
      conversationId: id,
    });
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark conversation as read',
    description: 'Mark all messages in a conversation as read.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Conversation marked as read',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Conversation not found' })
  async markAsRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.messagesService.markAsRead(id, user.userId);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get total unread message count',
    description: 'Get the total number of unread messages across all conversations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread message count',
    schema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          example: 5,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUnreadCount(@CurrentUser() user: CurrentUserData) {
    const count = await this.messagesService.getUnreadCount(user.userId);
    return { count };
  }
}


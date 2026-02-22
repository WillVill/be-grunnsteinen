import {
  Controller,
  Get,
  Post,
  Delete,
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
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get paginated notifications for current user',
    description: 'Get paginated list of notifications for the current authenticated user.',
  })
  @ApiQuery({ name: 'query', type: PaginationQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of notifications',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findByUser(
    @CurrentUser() user: CurrentUserData,
    @Query() query: PaginationQueryDto,
  ) {
    return this.notificationsService.findByUser(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Get the total number of unread notifications for the current user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread notification count',
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
    const count = await this.notificationsService.getUnreadCount(user.userId);
    return { count };
  }

  @Post(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Mark a specific notification as read.',
  })
  @ApiParam({ name: 'id', description: 'Notification ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Notification not found' })
  async markAsRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Mark all notifications for the current user as read.',
  })
  @ApiResponse({
    status: 204,
    description: 'All notifications marked as read',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markAllAsRead(@CurrentUser() user: CurrentUserData) {
    await this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a notification',
    description: 'Delete a specific notification. Users can only delete their own notifications.',
  })
  @ApiParam({ name: 'id', description: 'Notification ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Notification deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Notification not found' })
  async delete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.notificationsService.delete(id, user.userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete all notifications for current user',
    description: 'Delete all notifications for the current authenticated user.',
  })
  @ApiResponse({
    status: 204,
    description: 'All notifications deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteAll(@CurrentUser() user: CurrentUserData) {
    await this.notificationsService.deleteAll(user.userId);
  }
}


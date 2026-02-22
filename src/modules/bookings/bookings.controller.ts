import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
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
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  UpdateBookingDto,
  CancelBookingDto,
  BookingQueryDto,
  BookingResponseDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Bookings')
@ApiBearerAuth('JWT-auth')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new booking',
    description: 'Create a new booking for a resource. The booking will be pending or confirmed based on resource requirements.',
  })
  @ApiBody({ type: CreateBookingDto })
  @ApiResponse({
    status: 201,
    description: 'Booking created successfully',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input or resource unavailable' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Resource not found' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createBookingDto: CreateBookingDto,
  ) {
    return this.bookingsService.create(
      user.userId,
      user.organizationId,
      createBookingDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get paginated bookings',
    description: 'Get paginated list of bookings. Board members see all bookings, regular users see only their own.',
  })
  @ApiQuery({ name: 'query', type: BookingQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of bookings',
    type: BookingResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: BookingQueryDto,
  ) {
    const isBoard = ['board', 'admin'].includes(user.role);
    return this.bookingsService.findAll(
      user.organizationId,
      user.userId,
      query,
      isBoard,
    );
  }

  @Get('my')
  @ApiOperation({
    summary: 'Get current user\'s bookings',
    description: 'Get paginated list of bookings for the current authenticated user.',
  })
  @ApiQuery({ name: 'query', type: BookingQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of user bookings',
    type: BookingResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMyBookings(
    @CurrentUser() user: CurrentUserData,
    @Query() query: BookingQueryDto,
  ) {
    return this.bookingsService.findUserBookings(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get booking by ID',
    description: 'Get detailed information about a specific booking by its ID.',
  })
  @ApiParam({ name: 'id', description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Booking details',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Booking not found' })
  async findOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const isBoard = ['board', 'admin'].includes(user.role);
    return this.bookingsService.findById(id, user.userId, isBoard);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update booking',
    description: 'Update booking details. Users can update their own bookings, board members can update any booking.',
  })
  @ApiParam({ name: 'id', description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: UpdateBookingDto })
  @ApiResponse({
    status: 200,
    description: 'Booking updated',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Booking not found' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateBookingDto,
  ) {
    const isBoard = ['board', 'admin'].includes(user.role);
    return this.bookingsService.update(id, user.userId, isBoard, updateBookingDto);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({
    summary: 'Approve booking',
    description: 'Approve a pending booking. Only board members and admins can approve bookings.',
  })
  @ApiParam({ name: 'id', description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Booking approved',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Booking cannot be approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Booking not found' })
  async approve(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.bookingsService.approve(id, user.userId);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({
    summary: 'Reject booking',
    description: 'Reject a pending booking. Only board members and admins can reject bookings.',
  })
  @ApiParam({ name: 'id', description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          example: 'Resource unavailable',
          description: 'Optional reason for rejection',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Booking rejected',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Booking cannot be rejected' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Booking not found' })
  async reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.bookingsService.reject(id, user.userId, body.reason);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel booking',
    description: 'Cancel a booking. Users can cancel their own bookings, board members can cancel any booking.',
  })
  @ApiParam({ name: 'id', description: 'Booking ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: CancelBookingDto })
  @ApiResponse({
    status: 200,
    description: 'Booking cancelled',
    type: BookingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Booking cannot be cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Booking not found' })
  async cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() cancelBookingDto: CancelBookingDto,
  ) {
    return this.bookingsService.cancel(id, user.userId, cancelBookingDto.reason);
  }
}


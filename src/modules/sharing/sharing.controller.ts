import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { SharingService } from './sharing.service';
import {
  CreateHelpRequestDto,
  CreateSharedItemDto,
  UpdateSharedItemDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { HelpRequestCategory, HelpRequestStatus } from './schemas/help-request.schema';
import { SharedItemCategory } from './schemas/shared-item.schema';
import { IsOptional, IsEnum, IsBoolean, IsMongoId } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { S3Service } from '../../shared/services/s3.service';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';

class HelpRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HelpRequestCategory })
  @IsOptional()
  @IsEnum(HelpRequestCategory)
  category?: HelpRequestCategory;

  @ApiPropertyOptional({ enum: HelpRequestStatus })
  @IsOptional()
  @IsEnum(HelpRequestStatus)
  status?: HelpRequestStatus;
}

class SharedItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SharedItemCategory })
  @IsOptional()
  @IsEnum(SharedItemCategory)
  category?: SharedItemCategory;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;
}

@ApiTags('Sharing')
@ApiBearerAuth('JWT-auth')
@Controller('sharing')
export class SharingController {
  constructor(
    private readonly sharingService: SharingService,
    private readonly s3Service: S3Service,
  ) {}

  // ==================== Help Request Endpoints ====================

  @Post('help-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new help request',
    description: 'Create a new help request in the organization. Other users can accept and help with the request.',
  })
  @ApiBody({ type: CreateHelpRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Help request created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createHelpRequest(
    @CurrentUser() user: CurrentUserData,
    @Body() createHelpRequestDto: CreateHelpRequestDto,
  ) {
    return this.sharingService.createHelpRequest(
      user.userId,
      user.organizationId,
      createHelpRequestDto,
    );
  }

  @Get('help-requests')
  @ApiOperation({
    summary: 'Get paginated help requests',
    description: 'Get paginated list of help requests in the organization. Can filter by category and status.',
  })
  @ApiQuery({ name: 'query', type: HelpRequestQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of help requests',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAllHelpRequests(
    @CurrentUser() user: CurrentUserData,
    @Query() query: HelpRequestQueryDto,
  ) {
    return this.sharingService.findAllHelpRequests(user.organizationId, query);
  }

  @Get('help-requests/:id')
  @ApiOperation({
    summary: 'Get help request by ID',
    description: 'Get detailed information about a specific help request by its ID.',
  })
  @ApiParam({ name: 'id', description: 'Help Request ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Help request details',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Help request not found' })
  async findHelpRequestById(@Param('id') id: string) {
    return this.sharingService.findHelpRequestById(id);
  }

  @Post('help-requests/:id/accept')
  @ApiOperation({
    summary: 'Accept a help request',
    description: 'Accept an open help request. Users cannot accept their own requests.',
  })
  @ApiParam({ name: 'id', description: 'Help Request ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Help request accepted',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot accept help request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Help request not found' })
  async acceptHelpRequest(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.sharingService.acceptHelpRequest(id, user.userId);
  }

  @Post('help-requests/:id/complete')
  @ApiOperation({
    summary: 'Complete a help request',
    description: 'Mark a help request as completed. Only the requester or helper can complete it.',
  })
  @ApiParam({ name: 'id', description: 'Help Request ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Help request completed',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot complete help request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Help request not found' })
  async completeHelpRequest(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.sharingService.completeHelpRequest(id, user.userId);
  }

  @Post('help-requests/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a help request',
    description: 'Cancel a help request. Only the requester can cancel their own requests.',
  })
  @ApiParam({ name: 'id', description: 'Help Request ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Help request cancelled',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot cancel help request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Help request not found' })
  async cancelHelpRequest(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.sharingService.cancelHelpRequest(id, user.userId);
  }

  // ==================== Shared Item Endpoints ====================

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new shared item',
    description: 'Create a new shared item that can be borrowed by other users in the organization.',
  })
  @ApiBody({ type: CreateSharedItemDto })
  @ApiResponse({
    status: 201,
    description: 'Shared item created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createSharedItem(
    @CurrentUser() user: CurrentUserData,
    @Body() createSharedItemDto: CreateSharedItemDto,
  ) {
    if (!user?.userId || !user?.organizationId) {
      throw new BadRequestException('User or organization context missing');
    }
    return this.sharingService.createSharedItem(
      user.userId,
      user.organizationId,
      createSharedItemDto,
    );
  }

  @Get('items')
  @ApiOperation({
    summary: 'Get paginated shared items',
    description: 'Get paginated list of shared items in the organization. Can filter by category and availability.',
  })
  @ApiQuery({ name: 'query', type: SharedItemQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of shared items',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAllSharedItems(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SharedItemQueryDto,
  ) {
    return this.sharingService.findAllSharedItems(user.organizationId, query);
  }

  @Get('items/:id')
  @ApiOperation({
    summary: 'Get shared item by ID',
    description: 'Get detailed information about a specific shared item by its ID.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Shared item details',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async findSharedItemById(@Param('id') id: string) {
    return this.sharingService.findSharedItemById(id);
  }

  @Patch('items/:id')
  @ApiOperation({
    summary: 'Update shared item',
    description: 'Update shared item details. Only the owner can update their items.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: UpdateSharedItemDto })
  @ApiResponse({
    status: 200,
    description: 'Shared item updated',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async updateSharedItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() updateSharedItemDto: UpdateSharedItemDto,
  ) {
    return this.sharingService.updateSharedItem(id, user.userId, updateSharedItemDto);
  }

  @Post('items/:id/toggle-availability')
  @ApiOperation({
    summary: 'Toggle item availability',
    description: 'Toggle the availability status of a shared item. Only the owner can toggle availability.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Availability toggled',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async toggleAvailability(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.sharingService.toggleAvailability(id, user.userId);
  }

  @Post('items/:id/request-borrow')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request to borrow an item',
    description: 'Send a message to the owner requesting to borrow a shared item.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Borrow request sent',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot request to borrow' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async requestToBorrow(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.sharingService.requestToBorrow(id, user.userId);
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete shared item',
    description: 'Delete a shared item. Only the owner can delete their items.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Shared item deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot delete item' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async deleteSharedItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.sharingService.deleteSharedItem(id, user.userId);
  }

  @Post('items/:id/image')
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload shared item image',
    description: 'Upload an image for a shared item. Only the owner can upload images.',
  })
  @ApiParam({ name: 'id', description: 'Shared Item ID', example: '507f1f77bcf86cd799439011' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Item image file (jpg, png, webp)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Image uploaded successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Shared item not found' })
  async uploadImage(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // Upload to S3
    const imageUrl = await this.s3Service.uploadFile(
      file,
      `sharing/items/${id}/images`,
    );

    // Update item with image URL
    return this.sharingService.updateSharedItem(id, user.userId, { imageUrl });
  }
}


import {
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
  UseGuards,
  ParseIntPipe,
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
import { GroupsService } from './groups.service';
import {
  CreateGroupDto,
  UpdateGroupDto,
  GroupQueryDto,
  AddMemberDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { S3Service } from '../../shared/services/s3.service';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';

@ApiTags('Groups')
@ApiBearerAuth('JWT-auth')
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly s3Service: S3Service,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new group',
    description: 'Create a new group in the organization. The creator automatically becomes a member.',
  })
  @ApiBody({ type: CreateGroupDto })
  @ApiResponse({
    status: 201,
    description: 'Group created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createGroupDto: CreateGroupDto,
  ) {
    return this.groupsService.create(
      user.userId,
      user.organizationId,
      createGroupDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get paginated groups in organization',
    description: 'Get paginated list of groups in the organization. Users can filter by membership and privacy status.',
  })
  @ApiQuery({ name: 'query', type: GroupQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of groups',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: GroupQueryDto,
  ) {
    return this.groupsService.findAll(
      user.organizationId,
      user.userId,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get group by ID',
    description: 'Get detailed information about a specific group by its ID.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Group details',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async findOne(@Param('id') id: string) {
    return this.groupsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update group',
    description: 'Update group details. Only the creator or board members can update groups.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: UpdateGroupDto })
  @ApiResponse({
    status: 200,
    description: 'Group updated',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, user.userId, updateGroupDto);
  }

  @Post(':id/image')
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload group image',
    description: 'Upload an image for a group. Only the creator or board members can upload images.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Group image file (jpg, png, webp)',
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
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
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
      `groups/${id}/images`,
    );

    // Update group with image URL
    return this.groupsService.uploadImage(id, user.userId, imageUrl);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add member to group',
    description: 'Add a user to the group. Only the creator or board members can add members. Sends a notification to the added user.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: AddMemberDto })
  @ApiResponse({
    status: 201,
    description: 'Member added successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - User already a member' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Group or user not found' })
  async addMember(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() addMemberDto: AddMemberDto,
  ) {
    return this.groupsService.addMember(id, user.userId, addMemberDto);
  }

  @Post(':id/join')
  @ApiOperation({
    summary: 'Join a public group',
    description: 'Join a public group. Private groups require invitation.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Successfully joined group',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot join group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async join(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.groupsService.join(id, user.userId);
  }

  @Post(':id/leave')
  @ApiOperation({
    summary: 'Leave group',
    description: 'Leave a group. The creator cannot leave until they transfer ownership or delete the group.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Successfully left group',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Cannot leave group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async leave(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.groupsService.leave(id, user.userId);
  }

  @Get(':id/members')
  @ApiOperation({
    summary: 'Get group members',
    description: 'Get list of all members in a group.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'List of group members',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async getMembers(
    @Param('id') id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.groupsService.getMembers(id, page || 1, limit || 50);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete group',
    description: 'Delete a group. Only the creator or board members can delete groups.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Group deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Group not found' })
  async delete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.groupsService.delete(id, user.userId);
  }
}


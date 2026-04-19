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
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { ResourcesService } from './resources.service';
import {
  CreateResourceDto,
  UpdateResourceDto,
  ResourceQueryDto,
  ResourceResponseDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { S3Service } from '../../shared/services/s3.service';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

class AvailabilityQueryDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  start?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  end?: Date;
}

@ApiTags('Resources')
@ApiBearerAuth('JWT-auth')
@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly s3Service: S3Service,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Create a new resource (Board/Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Resource created successfully',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createResourceDto: CreateResourceDto,
  ) {
    return this.resourcesService.create(user.organizationId, createResourceDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated resources in organization' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of resources',
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ResourceQueryDto,
  ) {
    return this.resourcesService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get resource by ID' })
  @ApiResponse({
    status: 200,
    description: 'Resource details',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async findOne(@Param('id') id: string) {
    return this.resourcesService.findById(id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Get resource availability for date range' })
  @ApiResponse({
    status: 200,
    description: 'Available time slots',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
          available: { type: 'boolean' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getAvailability(
    @Param('id') id: string,
    @Query() query: AvailabilityQueryDto,
  ) {
    const { start, end } = query;

    if (!start || !end) {
      throw new BadRequestException('Start and end dates are required');
    }

    return this.resourcesService.getAvailability(id, start, end);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Update resource (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Resource updated',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async update(
    @Param('id') id: string,
    @Body() updateResourceDto: UpdateResourceDto,
  ) {
    return this.resourcesService.update(id, updateResourceDto);
  }

  @Post(':id/image')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ThrottleUpload()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload image to resource (Board/Admin only)' })
  @ApiParam({ name: 'id', description: 'Resource ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Resource image file (jpg, png, webp)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Image uploaded successfully',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const imageUrl = await this.s3Service.uploadFile(
      file,
      `resources/${id}/images`,
    );
    return this.resourcesService.addImages(id, [imageUrl]);
  }

  @Post(':id/images')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Add images to resource (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Images added successfully',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async addImages(
    @Param('id') id: string,
    @Body() body: { imageUrls: string[] },
  ) {
    return this.resourcesService.addImages(id, body.imageUrls);
  }

  @Delete(':id/images')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove image from resource (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Image removed successfully',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async removeImage(
    @Param('id') id: string,
    @Body() body: { imageUrl: string },
  ) {
    return this.resourcesService.removeImage(id, body.imageUrl);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate resource (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Resource deactivated',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async deactivate(@Param('id') id: string) {
    return this.resourcesService.deactivate(id);
  }
}


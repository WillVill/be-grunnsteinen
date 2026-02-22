import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto, OrganizationResponseDto } from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';

@ApiTags('Organizations')
@ApiBearerAuth('JWT-auth')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current user\'s organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization details',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async getCurrent(@CurrentUser() user: CurrentUserData) {
    return this.organizationsService.findById(user.organizationId);
  }

  @Patch('current')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Update current organization (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async updateCurrent(
    @CurrentUser() user: CurrentUserData,
    @Body() updateDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(user.organizationId, updateDto);
  }

  @Post('current/logo')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload organization logo (Board/Admin only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Logo image file (jpg, png, webp)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Logo uploaded successfully',
    type: OrganizationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async uploadLogo(
    @CurrentUser() user: CurrentUserData,
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
    return this.organizationsService.uploadLogo(user.organizationId, file);
  }

  @Get('current/stats')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({ summary: 'Get organization statistics (Board/Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Organization statistics',
    schema: {
      properties: {
        userCount: { type: 'number', example: 42 },
        activeBookings: { type: 'number', example: 5 },
        upcomingEvents: { type: 'number', example: 3 },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async getStats(@CurrentUser() user: CurrentUserData) {
    return this.organizationsService.getStats(user.organizationId);
  }
}


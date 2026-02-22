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
import { DocumentsService } from './documents.service';
import {
  UploadDocumentDto,
  UpdateDocumentDto,
  DocumentQueryDto,
} from './dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ThrottleUpload } from '../../common/decorators/throttle-upload.decorator';

@ApiTags('Documents')
@ApiBearerAuth('JWT-auth')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload a document',
    description: 'Upload a document to the organization. Only board members and admins can upload documents.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title', 'category'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file',
        },
        title: {
          type: 'string',
          minLength: 2,
          maxLength: 100,
          example: 'Building Rules and Regulations',
        },
        description: {
          type: 'string',
          example: 'Updated building rules effective January 2024',
        },
        category: {
          type: 'string',
          enum: ['rules', 'minutes', 'fdv', 'manuals', 'contracts', 'other'],
          example: 'rules',
        },
        isPublic: {
          type: 'boolean',
          example: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input or file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async upload(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() uploadDto: UploadDocumentDto,
  ) {
    return this.documentsService.upload(
      user.userId,
      user.organizationId,
      file,
      uploadDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get paginated documents',
    description: 'Get paginated list of documents in the organization. Can filter by category and search.',
  })
  @ApiQuery({ name: 'query', type: DocumentQueryDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of documents',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: DocumentQueryDto,
  ) {
    return this.documentsService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get document by ID',
    description: 'Get detailed information about a specific document by its ID.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Document details',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not Found - Document not found' })
  async findOne(@Param('id') id: string) {
    return this.documentsService.findById(id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Get presigned download URL for document',
    description: 'Get a presigned URL to download a document. URL expires after 1 hour.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 200,
    description: 'Download URL',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example: 'https://s3.amazonaws.com/bucket/key?signature=...',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Document not found' })
  async getDownloadUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    const url = await this.documentsService.getDownloadUrl(id, user.userId);
    return { url };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({
    summary: 'Update document',
    description: 'Update document details. Only board members and admins can update documents.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', example: '507f1f77bcf86cd799439011' })
  @ApiBody({ type: UpdateDocumentDto })
  @ApiResponse({
    status: 200,
    description: 'Document updated',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Document not found' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() updateDto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(id, user.userId, updateDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete document',
    description: 'Delete a document. Only board members and admins can delete documents. This also deletes the file from S3.',
  })
  @ApiParam({ name: 'id', description: 'Document ID', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({
    status: 204,
    description: 'Document deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Not Found - Document not found' })
  async delete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.documentsService.delete(id, user.userId);
  }
}


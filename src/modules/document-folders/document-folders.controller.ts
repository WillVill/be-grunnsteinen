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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { DocumentFoldersService } from './document-folders.service';
import {
  CreateDocumentFolderDto,
  UpdateDocumentFolderDto,
  DocumentFolderQueryDto,
} from './dto';
import {
  CurrentUser,
  CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Document Folders')
@ApiBearerAuth('JWT-auth')
@Controller('document-folders')
export class DocumentFoldersController {
  constructor(
    private readonly documentFoldersService: DocumentFoldersService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a document folder',
    description:
      'Create a new folder for documents. Only board members and admins.',
  })
  @ApiBody({ type: CreateDocumentFolderDto })
  @ApiResponse({ status: 201, description: 'Folder created' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate name' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createDto: CreateDocumentFolderDto,
  ) {
    return this.documentFoldersService.create(
      user.userId,
      user.organizationId,
      createDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List document folders',
    description:
      'Returns folders in the organization, optionally filtered by building. Building-scoped queries also include concept-wide folders.',
  })
  @ApiQuery({ name: 'query', type: DocumentFolderQueryDto, required: false })
  @ApiResponse({ status: 200, description: 'List of folders' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: DocumentFolderQueryDto,
  ) {
    return this.documentFoldersService.findAll(
      user.organizationId,
      user.role,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get folder by ID' })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  @ApiResponse({ status: 200, description: 'Folder details' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  async findOne(@Param('id') id: string) {
    return this.documentFoldersService.findById(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @ApiOperation({
    summary: 'Update folder',
    description:
      'Rename or update the description. Scope (concept/building) cannot be changed.',
  })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  @ApiBody({ type: UpdateDocumentFolderDto })
  @ApiResponse({ status: 200, description: 'Folder updated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate name' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() updateDto: UpdateDocumentFolderDto,
  ) {
    return this.documentFoldersService.update(
      id,
      user.organizationId,
      updateDto,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('board', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete folder',
    description:
      'Delete a folder. Blocked if the folder contains documents — move or delete them first.',
  })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  @ApiResponse({ status: 204, description: 'Folder deleted' })
  @ApiResponse({ status: 400, description: 'Folder not empty' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  async delete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.documentFoldersService.delete(id, user.organizationId);
  }
}

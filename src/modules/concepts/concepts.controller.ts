import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { ConceptsService } from "./concepts.service";
import { CreateConceptDto, UpdateConceptDto } from "./dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  CurrentUserData,
} from "../../common/decorators/current-user.decorator";
import { ThrottleUpload } from "../../common/decorators/throttle-upload.decorator";
import { UserRole } from "../users/schemas/user.schema";

@ApiTags("Concepts")
@ApiBearerAuth("JWT-auth")
@Controller("concepts")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConceptsController {
  constructor(private readonly conceptsService: ConceptsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT)
  @ApiOperation({ summary: "List concepts in the current organization" })
  findAll(@CurrentUser() user: CurrentUserData) {
    return this.conceptsService.findAll(user.organizationId);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT)
  @ApiOperation({ summary: "Get a concept by id" })
  findOne(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.conceptsService.findOne(user.organizationId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Create a concept (Admin only)" })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateConceptDto,
  ) {
    return this.conceptsService.create(user.organizationId, dto);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Update a concept (Admin only)" })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
    @Body() dto: UpdateConceptDto,
  ) {
    return this.conceptsService.update(user.organizationId, id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Soft-delete a concept (Admin only, rejects when buildings exist)",
  })
  remove(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.conceptsService.remove(user.organizationId, id);
  }

  @Post(":id/logo")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ThrottleUpload()
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Upload concept logo (Board/Admin only)" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Logo uploaded" })
  uploadLogo(
    @CurrentUser() user: CurrentUserData,
    @Param("id") id: string,
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
    return this.conceptsService.uploadLogo(user.organizationId, id, file);
  }

  @Get(":id/stats")
  @Roles(UserRole.ADMIN, UserRole.BOARD)
  @ApiOperation({ summary: "Concept statistics" })
  getStats(@CurrentUser() user: CurrentUserData, @Param("id") id: string) {
    return this.conceptsService.getStats(user.organizationId, id);
  }
}

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
  ParseIntPipe,
} from "@nestjs/common";
import { Types } from "mongoose";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { EventsService } from "./events.service";
import {
  CreateEventDto,
  UpdateEventDto,
  EventQueryDto,
  EventResponseDto,
} from "./dto";
import {
  CurrentUser,
  CurrentUserData,
} from "../../common/decorators/current-user.decorator";
import { ObjectIdParam } from "../../common/decorators/object-id-param.decorator";
import { S3Service } from "../../shared/services/s3.service";
import { ThrottleUpload } from "../../common/decorators/throttle-upload.decorator";

@ApiTags("Events")
@ApiBearerAuth("JWT-auth")
@Controller("events")
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly s3Service: S3Service,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a new event" })
  @ApiResponse({
    status: 201,
    description: "Event created successfully",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid input or dates" })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createEventDto: CreateEventDto,
  ) {
    return this.eventsService.create(
      user.userId,
      user.organizationId,
      createEventDto,
    );
  }

  @Get()
  @ApiOperation({ summary: "Get paginated events in organization" })
  @ApiResponse({
    status: 200,
    description: "Paginated list of events",
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: EventQueryDto,
  ) {
    return this.eventsService.findAll(user.organizationId, user.userId, query);
  }

  @Get("upcoming")
  @ApiOperation({ summary: "Get upcoming events" })
  @ApiResponse({
    status: 200,
    description: "List of upcoming events",
  })
  async getUpcoming(
    @CurrentUser() user: CurrentUserData,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.eventsService.getUpcoming(user.organizationId, limit || 5);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get event by ID with details" })
  @ApiResponse({
    status: 200,
    description: "Event details",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async findOne(
    @CurrentUser() user: CurrentUserData,
    @ObjectIdParam("id") id: Types.ObjectId,
  ) {
    return this.eventsService.findById(id.toString(), user.organizationId);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update event (organizer or board only)" })
  @ApiResponse({
    status: 200,
    description: "Event updated",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async update(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
    @Body() updateEventDto: UpdateEventDto,
  ) {
    return this.eventsService.update(id.toString(), userId, updateEventDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete event (organizer or board only)" })
  @ApiResponse({
    status: 204,
    description: "Event deleted successfully",
  })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async delete(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
  ) {
    await this.eventsService.delete(id.toString(), userId);
  }

  @Post(":id/cancel")
  @ApiOperation({ summary: "Cancel event (organizer or board only)" })
  @ApiResponse({
    status: 200,
    description: "Event cancelled",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async cancel(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
  ) {
    return this.eventsService.cancel(id.toString(), userId);
  }

  @Post(":id/join")
  @ApiOperation({ summary: "Join event" })
  @ApiResponse({
    status: 200,
    description: "Successfully joined event",
    type: EventResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Event full or already participating",
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async join(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
  ) {
    return this.eventsService.join(id.toString(), userId);
  }

  @Post(":id/leave")
  @ApiOperation({ summary: "Leave event" })
  @ApiResponse({
    status: 200,
    description: "Successfully left event",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 400, description: "Not participating in event" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async leave(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
  ) {
    return this.eventsService.leave(id.toString(), userId);
  }

  @Get(":id/participants")
  @ApiOperation({ summary: "Get event participants" })
  @ApiResponse({
    status: 200,
    description: "List of participants",
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async getParticipants(
    @ObjectIdParam("id") id: Types.ObjectId,
    @Query("page", new ParseIntPipe({ optional: true })) page?: number,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.eventsService.getParticipants(id.toString(), page || 1, limit || 50);
  }

  @Post(":id/image")
  @ThrottleUpload() // 10 requests per minute for file uploads
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Upload event image" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Event image file (jpg, png, webp)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Image uploaded successfully",
    type: EventResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid file" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async uploadImage(
    @CurrentUser("userId") userId: string,
    @ObjectIdParam("id") id: Types.ObjectId,
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
    const idStr = id.toString();
    const imageUrl = await this.s3Service.uploadFile(
      file,
      `public/events/${idStr}/images`,
    );

    // Update event with image URL
    return this.eventsService.update(idStr, userId, { imageUrl });
  }
}

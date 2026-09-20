---
paths:
  - "be_grunnsteinen/**"
---

# Backend Patterns (NestJS 10 / MongoDB)

## Project Structure

```
be_grunnsteinen/src/
├── common/
│   ├── schemas/base.schema.ts   # Base Mongoose schema options
│   ├── guards/                  # jwt-auth.guard, roles.guard
│   ├── filters/                 # Global HTTP exception filter
│   ├── decorators/              # @Public, @Roles, @CurrentUser
│   └── pipes/                   # ParseObjectIdPipe
├── config/
│   ├── database.module.ts       # MongoDB connection
│   └── configuration.ts         # Env config via ConfigService
├── shared/services/             # S3Service, EmailService, TwilioService, NotificationService
└── modules/                     # One module per feature
    └── [feature]/
        ├── [feature].module.ts
        ├── [feature].controller.ts
        ├── [feature].service.ts
        ├── schemas/[feature].schema.ts
        └── dto/
            ├── create-[feature].dto.ts
            └── update-[feature].dto.ts
```

## Controller Pattern

```tsx
@ApiTags('Features')
@ApiBearerAuth('JWT-auth')
@Controller('features')
export class FeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Post()
  @Roles('board', 'admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create feature' })
  @ApiResponse({ status: 201 })
  async create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateFeatureDto) {
    return this.featuresService.create(user.organizationId, user.userId, dto);
  }

  @Get()
  async findAll(@CurrentUser() user: CurrentUserData, @Query() query: PaginationQueryDto) {
    return this.featuresService.findAll(user.organizationId, query);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.featuresService.findOne(user.organizationId, id);
  }
}
```

`CurrentUserData`: `userId`, `email`, `role`, `organizationId`, `buildingIds`, `primaryBuildingId`.

## Service Pattern

```tsx
@Injectable()
export class FeaturesService {
  private readonly logger = new Logger(FeaturesService.name);

  constructor(
    @InjectModel(Feature.name) private readonly featureModel: Model<FeatureDocument>,
  ) {}

  async create(organizationId: string, userId: string, dto: CreateFeatureDto) {
    const feature = new this.featureModel({
      ...dto,
      organizationId: new Types.ObjectId(organizationId),
      authorId: new Types.ObjectId(userId),
    });
    await feature.save();
    this.logger.log(`Feature created: ${feature._id}`);
    return feature;
  }

  async findAll(organizationId: string, query: PaginationQueryDto) {
    const { page = 1, limit = 20 } = query;
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    const [data, total] = await Promise.all([
      this.featureModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      this.featureModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findOne(organizationId: string, id: string) {
    const feature = await this.featureModel.findOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    }).exec();
    if (!feature) throw new NotFoundException(`Feature "${id}" not found`);
    return feature;
  }
}
```

## Error Throwing

```tsx
throw new NotFoundException(`Resource "${id}" not found`);       // 404
throw new ConflictException(`Code "${code}" already exists`);    // 409
throw new ForbiddenException('Only the author can edit');         // 403
throw new BadRequestException('Invalid format');                  // 400
```

## Schema Pattern

```tsx
@Schema(baseSchemaOptions)   // from common/schemas/base.schema.ts
export class Feature {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FeatureCategory), required: true, index: true })
  category: FeatureCategory;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  @Prop({ default: false })
  isActive: boolean;
}

export const FeatureSchema = SchemaFactory.createForClass(Feature);
FeatureSchema.index({ organizationId: 1, createdAt: -1 });
```

## DTO Pattern

```tsx
// Create DTO — required fields, full validation
export class CreateFeatureDto {
  @ApiProperty({ example: 'Feature Name', minLength: 1, maxLength: 200 })
  @IsString() @MinLength(1) @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiProperty({ enum: FeatureCategory })
  @IsEnum(FeatureCategory)
  category: FeatureCategory;
}

// Update DTO — all fields optional
export class UpdateFeatureDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MinLength(1)
  name?: string;
}
```

## Auth & Authorization

- **JWT guard is global** — all routes protected by default
- `@Public()` — opt out of JWT guard (login, register, public endpoints)
- `@Roles('admin', 'board')` + `@UseGuards(RolesGuard)` — restrict by role
- `@CurrentUser()` — inject authenticated user data
- `@ThrottleUpload()` — 10 req/min for file upload routes
- Role hierarchy: `SUPER_ADMIN` > `ADMIN` > `BOARD` > `RESIDENT` (SUPER_ADMIN passes ADMIN checks)

## File Upload

```tsx
@Post(':id/image')
@ThrottleUpload()
@UseInterceptors(FileInterceptor('file'))
@ApiConsumes('multipart/form-data')
async uploadImage(
  @Param('id') id: string,
  @UploadedFile(new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
      new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
    ],
  })) file: Express.Multer.File,
) {
  const url = await this.s3Service.uploadFile(file, `features/${id}`);
  return { imageUrl: url };
}
```

## Global Error Response Format

```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/posts/123"
}
```

Handles: HttpException, Mongoose ValidationError (→400), CastError (→400), duplicate key E11000 (→409), unknown (→500).

## Validation

Global ValidationPipe: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. Unknown fields are rejected.

## TypeScript

- Strict mode **OFF** — be careful with null/undefined
- `emitDecoratorMetadata: true`, `experimentalDecorators: true`
- Target: ES2021, Module: CommonJS

## Key Rules

- Always scope queries by `organizationId`
- Always create a Logger: `private readonly logger = new Logger(ClassName.name)`
- Use `new Types.ObjectId(idString)` for ObjectId conversions
- Use `Promise.all()` for parallel queries (find + countDocuments)
- Return `PaginatedResponseDto` for list endpoints
- Rate limiting: 300/min global, 10/min for uploads
- Swagger docs at `/api/docs` (non-production only)

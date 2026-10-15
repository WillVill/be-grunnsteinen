import { IsOptional, IsEnum, IsBoolean, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PostCategory } from '../schemas/post.schema';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

export class PostQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by post category',
    enum: PostCategory,
    example: PostCategory.SOCIAL,
  })
  @IsOptional()
  @IsEnum(PostCategory)
  category?: PostCategory;

  @ApiPropertyOptional({
    description: 'Filter by author ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid author ID format' })
  authorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by pinned status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by board posts only',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  fromBoard?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by group ID (only posts belonging to this group)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid group ID format' })
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Exclude posts that belong to a group (only concept-wide posts)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  excludeGroupPosts?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by building ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    description: 'Filter by concept ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;
}


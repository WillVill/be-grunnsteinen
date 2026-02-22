import { IsOptional, IsEnum, IsBoolean, IsMongoId } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PostCategory } from '../schemas/post.schema';

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
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isPinned?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by board posts only',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  fromBoard?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by group ID (only posts belonging to this group)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid group ID format' })
  groupId?: string;

  @ApiPropertyOptional({
    description: 'Exclude posts that belong to a group (only org-wide posts)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  excludeGroupPosts?: boolean;
}


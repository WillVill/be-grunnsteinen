import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SharedItemCategory } from '../schemas/shared-item.schema';

export class UpdateSharedItemDto {
  @ApiPropertyOptional({
    example: 'Power Drill',
    minLength: 2,
    maxLength: 50,
    description: 'Item name',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Name must not exceed 50 characters' })
  name?: string;

  @ApiPropertyOptional({
    example: 'Cordless power drill with multiple drill bits included',
    maxLength: 500,
    description: 'Item description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiPropertyOptional({
    enum: SharedItemCategory,
    example: SharedItemCategory.TOOLS,
    description: 'Category of shared item',
  })
  @IsOptional()
  @IsEnum(SharedItemCategory)
  category?: SharedItemCategory;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the item is available for borrowing',
  })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}


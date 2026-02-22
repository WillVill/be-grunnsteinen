import {
  IsString,
  IsOptional,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Building ID the group belongs to',
  })
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId: string;
  @ApiProperty({
    example: 'Book Club',
    minLength: 2,
    maxLength: 50,
    description: 'Group name',
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Name must not exceed 50 characters' })
  name: string;

  @ApiPropertyOptional({
    example: 'A group for book lovers to discuss monthly reads',
    maxLength: 500,
    description: 'Group description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the group is private',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}


import {
  IsString,
  IsOptional,
  IsBoolean,
  IsMongoId,
  Matches,
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

  @ApiPropertyOptional({
    example: 'gallery/sport.jpg',
    description:
      'Reference to a curated gallery image (CloudFront read path). The backend resolves this to a full CloudFront URL and stores it as the group image. Mutually exclusive with uploading a file to POST /groups/:id/image.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^gallery\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i, {
    message: 'galleryKey must look like "gallery/<name>.<ext>"',
  })
  galleryKey?: string;
}


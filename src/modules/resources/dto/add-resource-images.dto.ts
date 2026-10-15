import { ArrayMaxSize, IsArray, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddResourceImagesDto {
  @ApiProperty({
    description: 'Image URLs to add to the resource',
    type: [String],
    maxItems: 20,
    example: ['https://example.com/image.jpg'],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  imageUrls: string[];
}

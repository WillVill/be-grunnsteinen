import { IsOptional, IsMongoId } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentFolderQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter folders by building. Returns folders scoped to the given building plus concept-wide folders.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid building ID format' })
  buildingId?: string;

  @ApiPropertyOptional({
    description: 'Filter folders by concept. Derived from buildingId when omitted.',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid concept ID format' })
  conceptId?: string;
}

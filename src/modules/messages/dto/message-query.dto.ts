import {
  IsMongoId,
  IsOptional,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class MessageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Conversation ID to get messages from (optional if provided in path)',
  })
  @IsOptional()
  @IsMongoId({ message: 'Invalid conversation ID format' })
  conversationId?: string;
}


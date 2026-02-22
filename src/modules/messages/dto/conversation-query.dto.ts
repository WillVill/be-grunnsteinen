import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ConversationQueryDto extends PaginationQueryDto {
  // Basic pagination only - no additional filters needed
}


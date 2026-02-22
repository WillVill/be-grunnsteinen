import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({
    description: 'User ID to add to the group',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId({ message: 'Invalid user ID format' })
  userId: string;
}

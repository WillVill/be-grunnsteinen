import { IsOptional, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmergencyContactDto, PetsDto } from './update-user.dto';

/**
 * Used by admins to edit a resident's pårørende / pets on their behalf
 * (PATCH /users/:id/care-info). Only the care-info fields are editable here.
 */
export class UpdateCareInfoDto {
  @ApiPropertyOptional({ type: [EmergencyContactDto], description: 'Pårørende / nødkontakter (maks 2)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactDto)
  emergencyContacts?: EmergencyContactDto[];

  @ApiPropertyOptional({ type: PetsDto, description: 'Kjæledyr' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PetsDto)
  pets?: PetsDto;
}

import {
  IsMongoId,
  IsDate,
  IsOptional,
  IsString,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'IsAfter', async: false })
export class IsAfterConstraint implements ValidatorConstraintInterface {
  validate(endDate: Date, args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    return endDate && relatedValue && endDate > relatedValue;
  }

  defaultMessage(args: ValidationArguments) {
    return 'End date must be after start date';
  }
}

@ValidatorConstraint({ name: 'IsFutureDate', async: false })
export class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(date: Date) {
    if (!date) return false;
    return date > new Date();
  }

  defaultMessage() {
    return 'Start date must be in the future';
  }
}

export class CreateBookingDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Resource ID to book',
  })
  @IsMongoId({ message: 'Invalid resource ID format' })
  resourceId: string;

  @ApiProperty({
    example: '2024-06-15T14:00:00.000Z',
    description: 'Booking start date and time',
  })
  @IsDate({ message: 'Start date must be a valid date' })
  @Type(() => Date)
  @Validate(IsFutureDateConstraint)
  startDate: Date;

  @ApiProperty({
    example: '2024-06-17T12:00:00.000Z',
    description: 'Booking end date and time',
  })
  @IsDate({ message: 'End date must be a valid date' })
  @Type(() => Date)
  @Validate(IsAfterConstraint, ['startDate'])
  endDate: Date;

  @ApiPropertyOptional({
    example: 'Please leave the apartment clean and tidy',
    description: 'User notes for the booking',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}


import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { PaymentReferenceDto, SeatAssignmentDto } from './booking.dto';

export class AddBaggageRequestDto {
  @ApiProperty()
  @IsString()
  passengerId: string;

  @ApiProperty()
  @IsString()
  itineraryId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty()
  @ValidateNested()
  @Type(() => PaymentReferenceDto)
  payment: PaymentReferenceDto;
}

export class DateChangeSearchItemDto {
  @ApiProperty()
  @IsString()
  itineraryId: string;

  @ApiProperty({ format: 'date' })
  @IsString()
  newDepartureDate: string;
}

export class DateChangeSearchRequestDto {
  @ApiProperty({ type: [DateChangeSearchItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DateChangeSearchItemDto)
  changes: DateChangeSearchItemDto[];
}

export class DateChangeRequestDto {
  @ApiProperty()
  @IsString()
  changeOfferId: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => PaymentReferenceDto)
  payment: PaymentReferenceDto;

  @ApiProperty({ type: [SeatAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatAssignmentDto)
  assignedSeats: SeatAssignmentDto[];
}

export class CancelBookingRequestDto {
  @ApiProperty()
  @IsString()
  quoteId: string;

  @ApiProperty()
  @IsString()
  reason: string;
}

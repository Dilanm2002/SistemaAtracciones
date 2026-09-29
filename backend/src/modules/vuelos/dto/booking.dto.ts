import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsArray, ValidateNested, IsOptional, IsInt } from 'class-validator';

export class PaymentReferenceDto {
  @ApiProperty({ description: 'Referencia a un pago gestionado por la Payment API' })
  @IsString()
  paymentReference: string;
}

export class SeatAssignmentDto {
  @ApiProperty()
  @IsString()
  segmentId: string;

  @ApiProperty()
  @IsString()
  seatNumber: string;
}

export class ExtraBaggageDto {
  @ApiProperty()
  @IsString()
  itineraryId: string;

  @ApiProperty()
  @IsInt()
  quantity: number;
}

export class PassengerContactDto {
  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty()
  @IsString()
  phone: string;
}

export class PassengerItemDto {
  @ApiProperty()
  @IsString()
  passengerId: string;

  @ApiProperty({ enum: ['ADULT', 'YOUTH', 'CHILD', 'INFANT'] })
  @IsString()
  passengerType: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  associatedAdultId?: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ enum: ['PASSPORT', 'NATIONAL_ID'] })
  @IsString()
  documentType: string;

  @ApiProperty()
  @IsString()
  documentNumber: string;

  @ApiProperty()
  @IsString()
  nationality: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsString()
  @IsOptional()
  documentExpiryDate?: string;

  @ApiProperty({ format: 'date' })
  @IsString()
  birthDate: string;

  @ApiProperty({ enum: ['M', 'F', 'X'] })
  @IsString()
  gender: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => PassengerContactDto)
  contact: PassengerContactDto;

  @ApiPropertyOptional({ type: [SeatAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatAssignmentDto)
  @IsOptional()
  assignedSeats?: SeatAssignmentDto[];

  @ApiPropertyOptional({ type: [ExtraBaggageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraBaggageDto)
  @IsOptional()
  extraBaggage?: ExtraBaggageDto[];
}

export class BookingRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  holdId: string;

  @ApiProperty({ type: [PassengerItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PassengerItemDto)
  passengers: PassengerItemDto[];

  @ApiProperty()
  @ValidateNested()
  @Type(() => PaymentReferenceDto)
  payment: PaymentReferenceDto;
}

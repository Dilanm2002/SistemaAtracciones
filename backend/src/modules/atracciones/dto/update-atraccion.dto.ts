import { PartialType } from '@nestjs/swagger';
import { CreateAtraccionDto } from './create-atraccion.dto';

/**
 * Para actualización parcial (PATCH), todos los campos de CreateAtraccionDto
 * son opcionales. Usamos PartialType de NestJS que hace esto automáticamente
 * y mantiene los decoradores de @ApiProperty con el flag `required: false`.
 */
export class UpdateAtraccionDto extends PartialType(CreateAtraccionDto) {}

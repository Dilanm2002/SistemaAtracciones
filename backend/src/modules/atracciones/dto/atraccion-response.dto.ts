import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BaseResponseDto } from '../../../common/dto/base-response.dto';
import { Link } from '../../../common/utils/hateoas';
import { PriceDto, LocationDto, PhotoDto, RatingDto, OperatorDto, UrlDto } from './nested-types.dto';
import { ProductType } from './create-atraccion.dto';

export class DestinationSummaryDto {
  @ApiProperty({ example: 8 }) code: number;
  @ApiProperty({ example: 'Cotopaxi' }) name: string;
  @ApiProperty({ example: 'Cotopaxi' }) province: string;
  @ApiProperty({ example: 'SIERRA' }) region: string;
}

export class AtraccionResponseDto extends BaseResponseDto {
  @ApiProperty({ description: 'UUID único de la atracción', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ description: 'Nombre de la atracción', example: 'Tour al Parque Nacional Cotopaxi' })
  name: string;

  @ApiProperty({ description: 'Descripción detallada' })
  long_description: string;

  @ApiProperty({ description: 'Duración (Formato ISO 8601)', example: 'PT8H' })
  duration: string;

  @ApiProperty({ description: 'Precio por adulto', type: PriceDto })
  price: PriceDto;

  @ApiProperty({ description: 'Empresa Operadora (null si no tiene asignada)', type: OperatorDto, nullable: true })
  operator: OperatorDto | null;

  @ApiProperty({ description: 'Tipo de producto', enum: ProductType, example: ProductType.GUIDED_TOUR })
  product_type: ProductType;

  @ApiProperty({ description: 'Qué incluye el paquete o tour', example: ['Transporte', 'Guía'] })
  includes: string[];

  @ApiProperty({ description: 'Slugs de categorías', example: ['naturaleza'] })
  categories: string[];

  @ApiProperty({ description: 'Insignias calculadas a partir de ventas, ocupación y antigüedad', example: ['best_seller'] })
  badges: string[];

  @ApiProperty({ description: 'Ubicaciones asociadas a la atracción', type: [LocationDto] })
  locations: LocationDto[];

  @ApiProperty({ description: 'Fotos de la atracción', type: [PhotoDto] })
  photos: PhotoDto[];

  @ApiProperty({ description: 'Idiomas soportados', example: ['es', 'en'] })
  supported_languages: string[];

  @ApiProperty({ description: 'Tiene cancelación gratuita', example: true })
  free_cancellation: boolean;

  @ApiProperty({ description: 'Puntuaciones y reseñas', type: RatingDto, required: false })
  ratings?: RatingDto;

  @ApiProperty({ description: 'Enlaces directos a la plataforma', type: UrlDto, required: false })
  url?: UrlDto;

  // ── Extensiones ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'tour-parque-nacional-cotopaxi' }) slug?: string;
  @ApiPropertyOptional({ enum: ['BORRADOR', 'EN_REVISION', 'PUBLICADA', 'RECHAZADA', 'INACTIVA'], description: 'EN_REVISION: subida por la empresa, pendiente de aprobación' }) status?: string;
  @ApiPropertyOptional({ description: 'Motivo indicado por el administrador cuando status = RECHAZADA' }) rejection_reason?: string;
  @ApiPropertyOptional() short_description?: string;
  @ApiPropertyOptional({ type: PriceDto }) child_price?: PriceDto;
  @ApiPropertyOptional() duration_hours?: number;
  @ApiPropertyOptional() not_includes?: string[];
  @ApiPropertyOptional() recommendations?: string[];
  @ApiPropertyOptional() times?: string[];
  @ApiPropertyOptional() capacity_per_slot?: number;
  @ApiPropertyOptional() cancellation_hours?: number;
  @ApiPropertyOptional() meeting_point?: string;
  @ApiPropertyOptional() featured?: boolean;
  @ApiPropertyOptional() is_active?: boolean;
  @ApiPropertyOptional({ type: DestinationSummaryDto }) destination?: DestinationSummaryDto;

  @ApiProperty({
    description: 'HATEOAS links para navegación',
    example: {
      self: { href: '/api/v1/atracciones/123e4567-e89b-12d3-a456-426614174000', method: 'GET' },
      availability: { href: '/api/v1/atracciones/123e4567-e89b-12d3-a456-426614174000/availability', method: 'GET' },
      reserve: { href: '/api/v1/atracciones/123e4567-e89b-12d3-a456-426614174000/reservations', method: 'POST' },
    },
  })
  _links?: Record<string, Link>;
}

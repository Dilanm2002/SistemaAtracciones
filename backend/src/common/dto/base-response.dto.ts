import { ApiPropertyOptional } from '@nestjs/swagger';
import { Link } from '../utils/hateoas';

export class BaseResponseDto {
  @ApiPropertyOptional({
    description: 'HATEOAS links (Richardson Maturity Model Level 3). Cada enlace trae href (ruta relativa al host de la API, con prefijo /api/v1) y método HTTP.',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: { href: { type: 'string', format: 'uri' }, method: { type: 'string', example: 'GET' } },
    },
  })
  _links?: Record<string, Link>;
}

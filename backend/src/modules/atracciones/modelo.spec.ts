import { ConfigService } from '@nestjs/config';
import { Rol, rolPrincipal, SCOPES, scopesDe } from '../../common/auth/scopes';
import { AtraccionMapper } from './atraccion.mapper';
import { codigoAleatorio } from './compras';
import { ProductType } from './dto/create-atraccion.dto';
import { ReservationStatus } from './dto/reservation.dto';
import { CONTRATO_A_TIPO, ESTADO_A_STATUS, FilaAtraccion, Region, slugify, STATUS_A_ESTADOS, TIPO_A_CONTRATO, TIPOS_DE } from './modelo';

describe('Traducción modelo relacional ↔ contrato', () => {
  it('cada product_type del contrato se guarda y se lee igual', () => {
    for (const t of Object.values(ProductType)) {
      expect(TIPO_A_CONTRATO[CONTRATO_A_TIPO[t]]).toBe(t);
      expect(TIPOS_DE[t]).toContain(CONTRATO_A_TIPO[t]);
    }
    expect(TIPO_A_CONTRATO.DAY_TRIP).toBe(ProductType.GUIDED_TOUR);
  });

  it('los estados de reserva del catálogo se mapean a los 3 del contrato', () => {
    for (const s of Object.values(ReservationStatus)) {
      STATUS_A_ESTADOS[s].forEach((codigo) => expect(ESTADO_A_STATUS[codigo]).toBe(s));
    }
  });

  it('roles N:M: el rol principal es el de más privilegios y los scopes se suman', () => {
    expect(rolPrincipal(['CLIENTE', 'OPERADOR'])).toBe(Rol.OPERADOR);
    expect(rolPrincipal([])).toBe(Rol.CLIENTE);
    const s = scopesDe(['CLIENTE', 'OPERADOR']);
    expect(s).toContain(SCOPES.MANAGE);
    expect(s).not.toContain(SCOPES.ADMIN);
    expect(new Set(s).size).toBe(s.length);
  });

  it('slug sin tildes ni símbolos', () => {
    expect(slugify('Laguna del Quilotoa: caminata por el cráter')).toBe('laguna-del-quilotoa-caminata-por-el-crater');
  });

  it('código de reserva: 6 caracteres sin 0/O/1/I', () => {
    for (let i = 0; i < 50; i++) expect(codigoAleatorio()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('AtraccionMapper', () => {
  const mapper = new AtraccionMapper(new ConfigService({ PUBLIC_URL: 'https://api.test', FRONTEND_URL: 'https://web.test' }));
  const fila: FilaAtraccion = {
    id: '7', uuid: '123e4567-e89b-42d3-a456-426614174000', nombre: 'Tour', slug: 'tour', descripcion: 'Descripción larga', descripcion_corta: null,
    tipo: 'PACKAGE', estado: 'PUBLICADA', latitud: -0.2, longitud: -78.5, direccion: null, punto_encuentro: null, duracion_horas: 96,
    moneda: 'USD', cancelacion_gratuita: true, horas_cancelacion: 72, destacada: false, rating: 4.8, numero_resenas: 10,
    creado_en: new Date('2025-01-01'), ciu_id: 3, ciudad: 'Quito', prov_id: 19, provincia: 'Pichincha', region: Region.SIERRA,
    ope_id: '1', ope_codigo: 101, operador: 'Andes', precio_adulto: 420, precio_nino: null, vendidos_60d: 25, ocupacion_14d: 0.8,
    fotos: [{ url: '/img/a.jpg', alt: 'Foto' }], horarios: [{ hora: '08:00', cupo: 12 }, { hora: '14:00', cupo: 16 }],
    categorias: ['naturales'], idiomas: ['es'],
    inclusiones: [{ tipo: 'INCLUYE', nombre: 'Guía' }, { tipo: 'NO_INCLUYE', nombre: 'Propinas' }, { tipo: 'RECOMENDACION', nombre: 'Abrigo' }],
  };

  it('expone el UUID público, la duración ISO y separa las inclusiones', () => {
    const r = mapper.toResponse(fila);
    expect(r.id).toBe(fila.uuid);
    expect(r.duration).toBe('PT96H');
    expect(r.product_type).toBe(ProductType.PACKAGE);
    expect([r.includes, r.not_includes, r.recommendations]).toEqual([['Guía'], ['Propinas'], ['Abrigo']]);
    expect(r.child_price?.total).toBe(420); // sin tarifa NINO → precio de adulto
    expect(r.capacity_per_slot).toBe(16);
    expect(r.photos[0].url).toBe('https://api.test/img/a.jpg');
    expect(r.locations[0].city).toBe(3);
  });

  it('insignias calculadas a partir de ventas y ocupación', () => {
    expect(mapper.insignias(fila)).toEqual(['best_seller', 'likely_to_sell_out']);
    expect(mapper.insignias({ ...fila, vendidos_60d: 0, ocupacion_14d: null })).toEqual([]);
  });
});

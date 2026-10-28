import { Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DbService, Params } from './comun/db.service';

/** Comparación sin tildes ni mayúsculas (sin depender de la extensión unaccent). */
const SIN_TILDES = (x: string) => `translate(lower(${x}), 'áéíóúüñ', 'aeiouun')`;
const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class ProvinciasQuery {
  @IsOptional() @Transform(entero) @IsInt() @Min(1) reg_id?: number;
}

export class CiudadesQuery {
  @IsOptional() @Transform(entero) @IsInt() @Min(1) prov_id?: number;
  @IsOptional() @Transform(entero) @IsInt() @Min(1) reg_id?: number;
  /** Texto del nombre (sin importar tildes ni mayúsculas): «banos» encuentra «Baños». */
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  /** Varios ids separados por coma (los resuelve ms_catalog en un solo viaje). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean).map(Number) : value))
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids?: number[];
  @IsOptional() @Transform(bool) @IsBoolean() ciu_activa?: boolean;
}

const SELECT_PROVINCIA = `SELECT p.prov_id, p.prov_nombre, p.prov_codigo, p.reg_id, r.reg_nombre, p.prov_activa
                            FROM provincia p JOIN region r ON r.reg_id = p.reg_id`;
const SELECT_CIUDAD = `SELECT c.ciu_id, c.ciu_nombre, c.ciu_codigo, c.prov_id, p.prov_nombre, p.reg_id, r.reg_nombre,
                              c.ciu_activa, c.ciu_descripcion, c.ciu_imagen
                         FROM ciudad c JOIN provincia p ON p.prov_id = c.prov_id JOIN region r ON r.reg_id = p.reg_id`;

/** Location Service: regiones, provincias y ciudades (catálogo de solo lectura que consultan los demás). */
@Injectable()
export class UbicacionService {
  constructor(private readonly db: DbService) {}

  regiones() {
    return this.db.query('SELECT reg_id, reg_nombre, reg_codigo FROM region ORDER BY reg_id');
  }

  provincias(q: ProvinciasQuery) {
    const p = new Params();
    const w = q.reg_id ? `WHERE p.reg_id = ${p.add(q.reg_id)}` : '';
    return this.db.query(`${SELECT_PROVINCIA} ${w} ORDER BY p.prov_nombre`, p.values);
  }

  async provincia(id: number) {
    const f = await this.db.one(`${SELECT_PROVINCIA} WHERE p.prov_id = $1`, [id]);
    if (!f) throw new NotFoundException(`La provincia ${id} no existe.`);
    return f;
  }

  ciudades(q: CiudadesQuery) {
    const p = new Params();
    const w: string[] = [];
    if (q.prov_id) w.push(`c.prov_id = ${p.add(q.prov_id)}`);
    if (q.reg_id) w.push(`p.reg_id = ${p.add(q.reg_id)}`);
    if (q.ids?.length) w.push(`c.ciu_id = ANY(${p.add(q.ids)}::smallint[])`);
    if (q.ciu_activa !== undefined) w.push(`c.ciu_activa = ${p.add(q.ciu_activa)}`);
    if (q.q) w.push(`${SIN_TILDES('c.ciu_nombre')} LIKE ${SIN_TILDES(p.add(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`))}`);
    return this.db.query(`${SELECT_CIUDAD} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY c.ciu_nombre`, p.values);
  }

  async ciudad(id: number) {
    const f = await this.db.one(`${SELECT_CIUDAD} WHERE c.ciu_id = $1`, [id]);
    if (!f) throw new NotFoundException(`La ciudad ${id} no existe.`);
    return f;
  }
}

@Controller({ version: '1' })
export class UbicacionController {
  constructor(private readonly s: UbicacionService) {}

  @Get('regiones')
  regiones() {
    return this.s.regiones();
  }

  @Get('provincias')
  provincias(@Query() q: ProvinciasQuery) {
    return this.s.provincias(q);
  }

  @Get('provincias/:prov_id')
  provincia(@Param('prov_id', ParseIntPipe) id: number) {
    return this.s.provincia(id);
  }

  @Get('ciudades')
  ciudades(@Query() q: CiudadesQuery) {
    return this.s.ciudades(q);
  }

  @Get('ciudades/:ciu_id')
  ciudad(@Param('ciu_id', ParseIntPipe) id: number) {
    return this.s.ciudad(id);
  }
}

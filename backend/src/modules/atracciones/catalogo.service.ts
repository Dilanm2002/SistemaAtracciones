import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtraccionMapper } from './atraccion.mapper';
import { CreateCategoriaDto, CreateDestinoDto, CreateOperadorDto, UpdateCategoriaDto, UpdateDestinoDto, UpdateOperadorDto } from './dto/catalogo.dto';
import { Atraccion } from './entities/atraccion.entity';
import { Categoria } from './entities/categoria.entity';
import { Destino } from './entities/destino.entity';
import { Operador } from './entities/operador.entity';

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

@Injectable()
export class CatalogoService {
  constructor(
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(Destino) private readonly destinos: Repository<Destino>,
    @InjectRepository(Operador) private readonly operadores: Repository<Operador>,
    @InjectRepository(Atraccion) private readonly atracciones: Repository<Atraccion>,
    private readonly mapper: AtraccionMapper,
  ) {}

  // ── Categorías ────────────────────────────────────────────────────────
  private async conteoPorCategoria(): Promise<Map<string, number>> {
    const rows = await this.atracciones.manager.query(
      `SELECT ac.categoria_id AS id, COUNT(*)::int AS total
         FROM atracciones_categorias ac JOIN atracciones a ON a.id = ac.atraccion_id
        WHERE a."estaActivo" = true AND a."deletedAt" IS NULL GROUP BY ac.categoria_id`,
    );
    return new Map(rows.map((r) => [r.id, r.total]));
  }

  async listCategorias(all: boolean) {
    const [rows, conteo] = await Promise.all([
      this.categorias.find({ where: all ? {} : { activa: true }, order: { orden: 'ASC', nombre: 'ASC' } }),
      this.conteoPorCategoria(),
    ]);
    return rows.map((c) => ({ ...c, total_atracciones: conteo.get(c.id) ?? 0 }));
  }

  async createCategoria(dto: CreateCategoriaDto) {
    const slug = dto.slug || slugify(dto.nombre);
    if (await this.categorias.exist({ where: { slug } })) throw new ConflictException(`Ya existe una categoría con el slug "${slug}".`);
    return this.categorias.save(this.categorias.create({ ...dto, slug }));
  }

  async updateCategoria(id: string, dto: UpdateCategoriaDto) {
    const c = await this.categorias.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Categoría no encontrada.');
    if (dto.slug && dto.slug !== c.slug && (await this.categorias.exist({ where: { slug: dto.slug } }))) {
      throw new ConflictException(`Ya existe una categoría con el slug "${dto.slug}".`);
    }
    Object.assign(c, dto);
    return this.categorias.save(c);
  }

  async deleteCategoria(id: string) {
    const c = await this.categorias.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Categoría no encontrada.');
    const [{ total }] = await this.atracciones.manager.query(
      'SELECT COUNT(*)::int AS total FROM atracciones_categorias WHERE categoria_id = $1',
      [id],
    );
    if (total > 0) throw new ConflictException(`La categoría tiene ${total} atracción(es) asociadas. Desactívala en lugar de eliminarla.`);
    await this.categorias.remove(c);
  }

  // ── Destinos ──────────────────────────────────────────────────────────
  async listDestinos(all: boolean) {
    const lista = await this.destinos.find({ where: all ? {} : { activo: true } });
    const conteo = await this.atracciones
      .createQueryBuilder('a')
      .select('a.destino', 'id')
      .addSelect('COUNT(*)', 'total')
      .where('a.estaActivo = true')
      .groupBy('a.destino')
      .getRawMany();
    const map = new Map(conteo.map((c) => [c.id, Number(c.total)]));
    return lista
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((d) => ({ ...d, imagen: d.imagen ? this.mapper.absUrl(d.imagen) : null, total_atracciones: map.get(d.id) ?? 0 }));
  }

  async createDestino(dto: CreateDestinoDto) {
    if (await this.destinos.exist({ where: { codigo: dto.codigo } })) throw new ConflictException(`Ya existe un destino con el código ${dto.codigo}.`);
    return this.destinos.save(this.destinos.create({ ...dto, imagen: dto.imagen ? this.mapper.relUrl(dto.imagen) : null }));
  }

  async updateDestino(id: string, dto: UpdateDestinoDto) {
    const d = await this.destinos.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Destino no encontrado.');
    if (dto.codigo && dto.codigo !== d.codigo && (await this.destinos.exist({ where: { codigo: dto.codigo } }))) {
      throw new ConflictException(`Ya existe un destino con el código ${dto.codigo}.`);
    }
    Object.assign(d, dto);
    if (dto.imagen !== undefined) d.imagen = dto.imagen ? this.mapper.relUrl(dto.imagen) : null;
    const saved = await this.destinos.save(d);
    if (dto.nombre) await this.atracciones.update({ destino: { id } }, { ciudad: dto.nombre });
    return saved;
  }

  async deleteDestino(id: string) {
    const d = await this.destinos.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Destino no encontrado.');
    const total = await this.atracciones.count({ where: { destino: { id } }, withDeleted: true });
    if (total > 0) throw new ConflictException(`El destino tiene ${total} atracción(es). Desactívalo en lugar de eliminarlo.`);
    await this.destinos.remove(d);
  }

  // ── Operadores ────────────────────────────────────────────────────────
  async listOperadores(all: boolean) {
    const rows = await this.operadores.find({ where: all ? {} : { activo: true }, order: { nombre: 'ASC' } });
    const conteo = await this.atracciones
      .createQueryBuilder('a')
      .select('a.operador', 'id')
      .addSelect('COUNT(*)', 'total')
      .groupBy('a.operador')
      .getRawMany();
    const map = new Map(conteo.map((c) => [c.id, Number(c.total)]));
    return rows.map((o) => ({ ...o, total_atracciones: map.get(o.id) ?? 0 }));
  }

  async createOperador(dto: CreateOperadorDto) {
    let codigo = dto.codigo;
    if (!codigo) {
      const { max } = await this.operadores.createQueryBuilder('o').select('COALESCE(MAX(o.codigo), 100)', 'max').getRawOne();
      codigo = Number(max) + 1;
    } else if (await this.operadores.exist({ where: { codigo } })) {
      throw new ConflictException(`Ya existe un operador con el código ${codigo}.`);
    }
    return this.operadores.save(this.operadores.create({ ...dto, codigo }));
  }

  async updateOperador(id: string, dto: UpdateOperadorDto) {
    const o = await this.operadores.findOne({ where: { id } });
    if (!o) throw new NotFoundException('Operador no encontrado.');
    Object.assign(o, dto);
    return this.operadores.save(o);
  }

  async deleteOperador(id: string) {
    const o = await this.operadores.findOne({ where: { id } });
    if (!o) throw new NotFoundException('Operador no encontrado.');
    const total = await this.atracciones.count({ where: { operador: { id } }, withDeleted: true });
    if (total > 0) throw new ConflictException(`El operador tiene ${total} atracción(es). Desactívalo en lugar de eliminarlo.`);
    await this.operadores.remove(o);
  }
}

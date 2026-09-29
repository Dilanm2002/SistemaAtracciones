import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { ProductType } from '../dto/create-atraccion.dto';
import { Categoria } from './categoria.entity';
import { Destino } from './destino.entity';
import { Operador } from './operador.entity';

@Entity('atracciones')
export class Atraccion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Campos originales de la plantilla ─────────────────────────────────
  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'text' })
  descripcion: string;

  /** Nombre de la ciudad (denormalizado desde `destino` para el esquema GraphQL) */
  @Column({ type: 'varchar', length: 100 })
  ciudad: string;

  @Column('numeric', { precision: 10, scale: 6, transformer: new ColumnNumericTransformer() })
  latitud: number;

  @Column('numeric', { precision: 10, scale: 6, transformer: new ColumnNumericTransformer() })
  longitud: number;

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  precioTicket: number;

  @Column('numeric', { precision: 5, scale: 2, transformer: new ColumnNumericTransformer() })
  duracionHoras: number;

  @Column({ type: 'boolean', default: true })
  estaActivo: boolean;

  // ── Campos ampliados para cumplir el contrato OpenAPI ─────────────────
  @Column({ type: 'varchar', length: 280, nullable: true })
  descripcionCorta: string | null;

  /** Precio para niños (3–11 años). Null = mismo precio que adulto. */
  @Column('numeric', { precision: 10, scale: 2, nullable: true, transformer: new ColumnNumericTransformer() })
  precioNino: number | null;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  moneda: string;

  @Column({ type: 'enum', enum: ProductType, default: ProductType.GUIDED_TOUR })
  tipoProducto: ProductType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  puntoEncuentro: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  fotos: string[];

  @Column({ type: 'simple-json', default: '[]' })
  incluye: string[];

  @Column({ type: 'simple-json', default: '[]' })
  noIncluye: string[];

  @Column({ type: 'simple-json', default: '[]' })
  recomendaciones: string[];

  @Column({ type: 'simple-json', default: '[]' })
  insignias: string[];

  @Column({ type: 'simple-json', default: '["es"]' })
  idiomas: string[];

  /** Horarios de salida diarios, ej. ["08:00","14:00"] */
  @Column({ type: 'simple-json', default: '["09:00"]' })
  horarios: string[];

  /** Cupo máximo por horario y fecha */
  @Column({ type: 'int', default: 20 })
  cupoPorHorario: number;

  @Column({ type: 'boolean', default: true })
  cancelacionGratuita: boolean;

  /** Horas de anticipación mínima para cancelar sin costo */
  @Column({ type: 'int', default: 24 })
  horasCancelacion: number;

  @Column({ type: 'boolean', default: false })
  destacado: boolean;

  @Column('numeric', { precision: 3, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  ratingPromedio: number;

  @Column({ type: 'int', default: 0 })
  numeroResenas: number;

  @ManyToOne(() => Destino, { eager: true, nullable: false })
  destino: Destino;

  @ManyToOne(() => Operador, { eager: true, nullable: true })
  operador: Operador | null;

  @ManyToMany(() => Categoria, { eager: true })
  @JoinTable({
    name: 'atracciones_categorias',
    joinColumn: { name: 'atraccion_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'categoria_id', referencedColumnName: 'id' },
  })
  categorias: Categoria[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date;
}

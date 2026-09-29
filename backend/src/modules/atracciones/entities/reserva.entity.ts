import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { ReservationStatus } from '../dto/reservation.dto';
import { Atraccion } from './atraccion.entity';

export enum MetodoPago {
  TARJETA = 'TARJETA',
  TRANSFERENCIA = 'TRANSFERENCIA',
  EN_SITIO = 'EN_SITIO',
}

@Entity('reservas')
@Index(['atraccion', 'fecha', 'hora'])
export class Reserva {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código legible para el cliente, ej. DEC-7F3K9Q */
  @Column({ type: 'varchar', length: 12, unique: true })
  codigo: string;

  @ManyToOne(() => Atraccion, { eager: true, nullable: false })
  atraccion: Atraccion;

  /**
   * Solo guardamos el ID del usuario (sin FK) para respetar el límite del
   * dominio: al separar Identidad en otro microservicio no hay que romper nada.
   */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  usuarioId: string | null;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 5 })
  hora: string;

  @Column({ type: 'int' })
  adultos: number;

  @Column({ type: 'int', default: 0 })
  ninos: number;

  @Column({ type: 'int' })
  ticketCount: number;

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  precioAdulto: number;

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  precioNino: number;

  @Column('numeric', { precision: 10, scale: 2, transformer: new ColumnNumericTransformer() })
  total: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  moneda: string;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.CONFIRMED })
  estado: ReservationStatus;

  @Column({ type: 'enum', enum: MetodoPago, default: MetodoPago.TARJETA })
  metodoPago: MetodoPago;

  @Column({ type: 'varchar', length: 120 })
  clienteNombre: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  clienteEmail: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clienteTelefono: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clienteDocumento: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notas: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  motivoCancelacion: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  canceladaEn: Date | null;

  @Column({ type: 'uuid', unique: true })
  idempotencyKey: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

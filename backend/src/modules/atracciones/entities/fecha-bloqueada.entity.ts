import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Atraccion } from './atraccion.entity';

/** Día en que una atracción no opera (feriado, mantenimiento, clima, etc.). */
@Entity('fechas_bloqueadas')
@Unique(['atraccion', 'fecha'])
export class FechaBloqueada {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Atraccion, { onDelete: 'CASCADE', nullable: false })
  atraccion: Atraccion;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 200 })
  motivo: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

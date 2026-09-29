import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Atraccion } from './atraccion.entity';

@Entity('resenas')
export class Resena {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Atraccion, { onDelete: 'CASCADE', nullable: false })
  atraccion: Atraccion;

  @Column({ type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'varchar', length: 120 })
  autorNombre: string;

  @Column({ type: 'int' })
  puntuacion: number;

  @Column({ type: 'varchar', length: 1000 })
  comentario: string;

  /** Moderación: el admin puede ocultar reseñas inapropiadas */
  @Column({ type: 'boolean', default: true })
  visible: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

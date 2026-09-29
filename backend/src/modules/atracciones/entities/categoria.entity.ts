import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('categorias')
export class Categoria {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Identificador estable usado en el contrato (`categories: ['aventura']`) */
  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 80 })
  nombre: string;

  /** Nombre de un ícono de lucide (ej. 'mountain', 'landmark') */
  @Column({ type: 'varchar', length: 40, default: 'map-pin' })
  icono: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descripcion: string | null;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Empresa proveedora que opera el tour (contrato: `operator: { id, name }`). */
@Entity('operadores')
export class Operador {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID numérico expuesto en el contrato */
  @Column({ type: 'int', unique: true })
  codigo: number;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'varchar', length: 13, nullable: true })
  ruc: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefono: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

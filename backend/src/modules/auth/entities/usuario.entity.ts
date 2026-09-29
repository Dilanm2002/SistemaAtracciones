import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Rol } from '../../../common/auth/scopes';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 100, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  documento: string | null;

  @Column({ type: 'enum', enum: Rol, default: Rol.CLIENTE })
  rol: Rol;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  ultimoAcceso: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

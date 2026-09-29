import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

export enum Region {
  SIERRA = 'SIERRA',
  COSTA = 'COSTA',
  AMAZONIA = 'AMAZONIA',
  GALAPAGOS = 'GALAPAGOS',
}

@Entity('destinos')
export class Destino {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID numérico de ciudad usado por el contrato (`cities: [1]`, `location.city`) */
  @Column({ type: 'int', unique: true })
  codigo: number;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 100 })
  provincia: string;

  @Column({ type: 'enum', enum: Region })
  region: Region;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  imagen: string | null;

  @Column('numeric', { precision: 10, scale: 6, transformer: new ColumnNumericTransformer() })
  latitud: number;

  @Column('numeric', { precision: 10, scale: 6, transformer: new ColumnNumericTransformer() })
  longitud: number;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

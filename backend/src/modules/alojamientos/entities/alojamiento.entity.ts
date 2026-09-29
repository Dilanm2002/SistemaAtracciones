import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

@Entity('alojamientos')
export class Alojamiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 255 })
  destino: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioPorNoche: number;

  @Column({ type: 'int' })
  capacidadAdultos: number;

  @Column({ type: 'int' })
  capacidadNinos: number;

  @Column({ type: 'int' })
  habitaciones: number;

  @Column({ type: 'boolean' })
  tienePiscina: boolean;
}

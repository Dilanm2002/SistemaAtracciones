import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

@Entity('vuelos')
export class Vuelo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  aerolinea: string;

  @Column({ type: 'varchar', length: 20 })
  codigoVuelo: string;

  @Column({ type: 'varchar', length: 10 })
  origenIATA: string;

  @Column({ type: 'varchar', length: 10 })
  destinoIATA: string;

  @Column({ type: 'timestamp' })
  fechaSalida: string;

  @Column({ type: 'timestamp' })
  fechaLlegada: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioBase: number;

  @Column({ type: 'int' })
  asientosDisponibles: number;
}

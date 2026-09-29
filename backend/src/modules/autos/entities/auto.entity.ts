import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

@Entity('autos')
export class Auto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  marca: string;

  @Column({ type: 'varchar', length: 100 })
  modelo: string;

  @Column({ type: 'varchar', length: 50 })
  tipo: string; // Validado en DTO (SUV, Sedan, Compacto)

  @Column({ type: 'varchar', length: 255 })
  ciudadRecogida: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioPorDia: number;

  @Column({ type: 'varchar', length: 50 })
  transmision: string; // Validado en DTO (Manual, Automatica)
}

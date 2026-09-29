import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Registro persistente de operaciones idempotentes.
 * Si un cliente reintenta la misma operación con la misma Idempotency-Key,
 * se devuelve la respuesta original en lugar de ejecutar la operación de nuevo.
 */
@Entity('idempotency_records')
export class IdempotencyRecord {
  @PrimaryColumn('uuid')
  key: string;

  @Column({ type: 'varchar', length: 150 })
  operacion: string;

  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'jsonb' })
  responseBody: any;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

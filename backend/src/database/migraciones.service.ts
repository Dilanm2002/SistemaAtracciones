import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { migrar } from './migrator';

/**
 * En desarrollo aplica las migraciones SQL pendientes al arrancar la API.
 * En producción (Vercel) se aplican en el build (`npm run vercel-build`), no aquí.
 */
@Injectable()
export class MigracionesService implements OnModuleInit {
  private readonly logger = new Logger('Migraciones');

  constructor(private readonly ds: DataSource, private readonly config: ConfigService) {}

  async onModuleInit() {
    const prod = this.config.get('NODE_ENV') === 'production';
    if (this.config.get('DB_MIGRATIONS_RUN', prod ? 'false' : 'true') !== 'true') return;
    await migrar(this.ds, (m) => this.logger.log(m));
  }
}

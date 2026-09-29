import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard, OptionalJwtGuard } from './auth/jwt-auth.guard';
import { SessionService } from './auth/session.service';
import { BitacoraService } from './db/bitacora.service';
import { CatalogosService } from './db/catalogos.service';
import { DbService } from './db/db.service';
import { IdempotencyKeyGuard } from './guards/idempotency-key.guard';
import { IdempotencyService } from './idempotency/idempotency.service';
import { StorageService } from './storage/storage.service';

const PROVIDERS = [
  DbService,
  CatalogosService,
  BitacoraService,
  IdempotencyService,
  IdempotencyKeyGuard,
  JwtAuthGuard,
  OptionalJwtGuard,
  StorageService,
  SessionService,
];

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Sin valor por defecto: env.validation.ts impide arrancar sin un secreto fuerte
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '2h') },
      }),
    }),
  ],
  providers: PROVIDERS,
  exports: [...PROVIDERS, JwtModule],
})
export class CommonModule {}

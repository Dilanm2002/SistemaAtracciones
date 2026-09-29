import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard, OptionalJwtGuard } from './auth/jwt-auth.guard';
import { IdempotencyKeyGuard } from './guards/idempotency-key.guard';
import { IdempotencyRecord } from './idempotency/idempotency-record.entity';
import { IdempotencyService } from './idempotency/idempotency.service';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([IdempotencyRecord]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'cambia-este-secreto-en-produccion'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h') },
      }),
    }),
  ],
  providers: [IdempotencyService, IdempotencyKeyGuard, JwtAuthGuard, OptionalJwtGuard, StorageService],
  exports: [StorageService, IdempotencyService, IdempotencyKeyGuard, JwtAuthGuard, OptionalJwtGuard, JwtModule],
})
export class CommonModule {}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CommonModule } from './common/common.module';
import { validateEnv } from './config/env.validation';
import { MigracionesService } from './database/migraciones.service';
import { AtraccionesModule } from './modules/atracciones/atracciones.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContactoModule } from './modules/contacto/contacto.module';
import { SeedService } from './seed/seed.service';

@Module({
  imports: [
    // Variables de entorno globales, validadas al arrancar (fail-fast)
    ConfigModule.forRoot({
      isGlobal: true,
      // En producción (Vercel) solo cuentan las variables del panel: nunca un .env olvidado (OPS-006)
      envFilePath: ['.env.local', '.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnv,
    }),

    // Límite de peticiones global: 120/min por IP. Las rutas sensibles
    // (login, registro, contacto, subidas) declaran límites más estrictos con @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    // Configuración centralizada de TypeORM usando DATABASE_URL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const prod = configService.get<string>('NODE_ENV') === 'production';
        return {
          type: 'postgres' as const,
          url: configService.get<string>('DATABASE_URL'),
          // El esquema es SQL-first (database/01_esquema.sql → src/database/sql): TypeORM solo
          // gestiona el pool de conexiones y las transacciones; nunca sincroniza ni crea tablas.
          entities: [],
          synchronize: false,
          migrationsRun: false,
          // Supabase (y la mayoría de Postgres en la nube) exige SSL
          ssl: configService.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
          // Pool pequeño: en serverless cada instancia abre sus propias conexiones
          extra: { max: Number(configService.get<string>('DB_POOL_MAX', prod ? '1' : '5')), connectionTimeoutMillis: 10000 },
          // En producción (serverless) fallar rápido y mostrar el error en los logs
          retryAttempts: prod ? 1 : 9,
          retryDelay: 2000,
        };
      },
    }),

    // Módulos Compartidos
    CommonModule,

    // Dominio de este equipo dentro del marketplace (los de vuelos, autos y alojamientos
    // son de otros equipos y se integrarán por el API Gateway / Apollo Federation).
    AtraccionesModule,

    // Dominios de soporte del equipo de Atracciones (Identidad y Contacto).
    // En la migración a microservicios se extraen como servicios independientes.
    AuthModule,
    ContactoModule,
  ],
  controllers: [],
  providers: [MigracionesService, SeedService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

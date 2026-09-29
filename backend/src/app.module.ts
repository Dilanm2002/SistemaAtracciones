import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CommonModule } from './common/common.module';
// import { AlojamientosModule } from './modules/alojamientos/alojamientos.module';
// import { AutosModule } from './modules/autos/autos.module';
import { AtraccionesModule } from './modules/atracciones/atracciones.module';
// import { VuelosModule } from './modules/vuelos/vuelos.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContactoModule } from './modules/contacto/contacto.module';
import { SeedService } from './seed/seed.service';

@Module({
  imports: [
    // Carga de variables de entorno globales
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Configuración centralizada de TypeORM usando DATABASE_URL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const sync = configService.get<string>('DB_SYNC');
        return {
          type: 'postgres' as const,
          url: configService.get<string>('DATABASE_URL'),
          autoLoadEntities: true,
          // DB_SYNC=true|false manda; si no existe, solo se sincroniza fuera de producción
          synchronize: sync ? sync === 'true' : configService.get<string>('NODE_ENV') !== 'production',
          // Supabase (y la mayoría de Postgres en la nube) exige SSL
          ssl: configService.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
          // Pool pequeño: en serverless cada instancia abre sus propias conexiones
          extra: { max: Number(configService.get<string>('DB_POOL_MAX', '5')) },
        };
      },
    }),

    // Módulos Compartidos
    CommonModule,

    // =========================================================================
    // ATENCIÓN ALUMNO: Descomenta solo el módulo que corresponde a tu grupo
    // =========================================================================
    // AlojamientosModule,
    // AutosModule,
    AtraccionesModule,
    // VuelosModule,

    // Dominios de soporte del equipo de Atracciones (Identidad y Contacto).
    // En la migración a microservicios se extraen como servicios independientes.
    AuthModule,
    ContactoModule,
  ],
  controllers: [],
  providers: [SeedService],
})
export class AppModule {}

# Booking Prototipo - Repositorio Plantilla

Esta es la plantilla base (API-First) para el desarrollo de los 4 dominios del sistema Booking Prototipo: Alojamientos, Autos, Atracciones y Vuelos. 

La arquitectura sigue los principios de Domain-Driven Design (DDD) y está preparada para una futura migración a Microservicios y Apollo Federation utilizando UUIDs y contratos estrictos documentados con Swagger.

## Instrucciones para los Equipos

1. **Clonar este repositorio** en su entorno local.
2. **Instalar dependencias necesarias**:

Ejecuta exactamente el siguiente comando en la raíz del proyecto para instalar las librerías base de NestJS, configuración, TypeORM, Swagger y validación:

```bash
npm install @nestjs/typeorm typeorm pg @nestjs/config class-validator class-transformer @nestjs/swagger
```

3. **Configurar el entorno**:
- Copia el archivo `.env.example` y renómbralo a `.env`.
- Levanta la base de datos usando Docker: `docker-compose up -d`.

4. **Habilitar el Módulo Correspondiente**:
- Abre el archivo `src/app.module.ts`.
- Descomenta **ÚNICAMENTE** el módulo asignado a tu equipo (por ejemplo, si eres el equipo de Autos, descomenta `AutosModule`).

5. **Ejecutar el proyecto**:
- Inicia el proyecto en modo desarrollo con `npm run start:dev`.
- Podrás ver la documentación de tu API en: `http://localhost:3000/api/docs`.

¡Mucho éxito con el desarrollo del Reto!

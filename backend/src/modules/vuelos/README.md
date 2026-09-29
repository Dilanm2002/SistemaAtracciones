# Módulo de Vuelos (GDS Flight Core API)

Este microservicio centraliza la lógica de Búsqueda, Ofertas, Retención (Hold), Reservas, Emisión de Tickets, Postventa, Check-in y Estado de Vuelos.

## Arquitectura y Límites de Dominio

La API de Vuelos actúa como un orquestador dentro de su propio dominio, pero **delega responsabilidades fundamentales** a otros microservicios mediante integración. No almacena información de tarjetas de crédito, ni gestiona perfiles complejos de clientes, ni emite facturas fiscales.

### Diagrama de Integración

```mermaid
graph TD
    %% Vuelos (Dominio Principal)
    subgraph Vuelos [Booking / Flight API]
        A[Search & Offers]
        B[Hold (Bloqueo)]
        C[Booking / PNR]
        D[Ticketing & Seats]
        E[Check-in & Boarding]
        F[Postventa: Fechas, Maletas, Cancelación]
    end

    %% Dominios Externos
    subgraph Pagos [Payment API]
        P1[3DS & Autorización]
        P2[Captura & Reembolso]
    end

    subgraph Clientes [Customer API]
        C1[Perfiles & Datos Personales]
        C2[Agenda de Contactos]
    end

    subgraph Facturacion [Billing API]
        B1[Facturación (Invoices)]
        B2[Notas de Crédito fiscales]
    end

    %% Relaciones
    Vuelos -->|paymentReference| Pagos
    Vuelos -->|Sub (JWT) / ownerId| Clientes
    Vuelos -->|Monto y Conceptos| Facturacion
```

### Flujo Típico (Happy Path)

1. **Autenticación (Identity Provider):** El usuario se autentica y obtiene un token JWT.
2. **Búsqueda (`/search`):** El cliente consulta vuelos. La API devuelve opciones (`offers`).
3. **Bloqueo (`/offers/hold`):** El usuario selecciona un vuelo. Se bloquea el cupo (Hold) por un tiempo determinado (ej. 15 minutos).
4. **Validación de Perfil:** (Fuera de esta API) El Frontend recupera del `Customer API` los datos de los pasajeros frecuentes.
5. **Procesamiento de Pago:** (Fuera de esta API) El Frontend se comunica con la `Payment API` para realizar el cobro (autorización de tarjeta, 3DS, etc.). Se obtiene un `paymentReference`.
6. **Reserva y Emisión (`/bookings`):** El Frontend llama a la API de Vuelos enviando el `holdId`, la lista de pasajeros y el `paymentReference`. 
7. **Confirmación:** La API de Vuelos (esta API) confirma el cupo, genera el PNR y (síncrona o asíncronamente) emite los Tickets. Opcionalmente dispara un Webhook y notifica a la `Billing API` para generar la factura.

## Notas Técnicas
- **Dueño de Reserva:** El usuario propietario se infiere del JWT (`sub`).
- **Idempotencia:** Endpoints críticos de escritura (`POST /bookings`, `POST /offers/hold`, pagos postventa, etc.) requieren el header `Idempotency-Key` para evitar transacciones duplicadas por reintentos de red.
- **Asíncronos:** Operaciones como emisión o cancelaciones pueden retornar un HTTP 202 (Accepted) y usar Webhooks (en `/webhooks`) para notificar al cliente cuando la operación termine de procesarse con el GDS (Global Distribution System).

> [!WARNING]
> **Aviso para el Equipo de Desarrollo (E-commerce / Integradores):**
> Todo el código actualmente implementado en el controlador (`vuelos.controller.ts`) y los DTOs sirve puramente como **ejemplo estructural y definición de contrato**. 
> Los *endpoints* están configurados para devolver datos simulados (mocks) en blanco. Ustedes deben clonar esta plantilla y **adaptar/conectar la lógica de negocio real** en el `VuelosService` (conexión a bases de datos, integraciones con el GDS real, validaciones, etc.) para que su plataforma funcione correctamente.

> [!IMPORTANT]
> **Recordatorio (Fase RDA1):**
> Nos encontramos en la fase **RDA1**. En esta etapa **aún no hay integración** entre plataformas. 
> El archivo OpenAPI sirve actualmente solo como una **guía obligatoria** para que todos sigamos los mismos parámetros y estructuras.
> 
> **Objetivo Actual:** Cada equipo debe construir su aplicativo para que funcione de manera independiente y **subir su API correspondiente a Render**. La verdadera integración (la comunicación entre las APIs) se realizará en las siguientes fases (RDA2, etc.), una vez que se haya verificado que todas las aplicaciones individuales funcionan correctamente en la nube.

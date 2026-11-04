-- Extras de Descubre EC sobre la sección 7 del script del equipo (solo se AGREGA; avisar al equipo).
--  · atraccion_ref: UUID público de cada atracción (ID lógico de ms_catalog). Booking identifica la
--    atracción por su UUID (item_id del stock y rutas del contrato v3).
--  · retencion: cupos descontados por cada reserva. Hace idempotente RetenerCupos/LiberarCupos
--    (un reintento de la saga no descuenta ni devuelve dos veces).
--  · sync_stock: cada PushStockUpdate a Booking (estado, intentos, latencia, respuesta).
--  · evento: outbox (STOCK_ACTUALIZADO al feed de eventos de ms_booking).

CREATE TABLE atraccion_ref (
    atr_id   BIGINT PRIMARY KEY,                -- ID logico (Catalog)
    atr_uuid UUID   NOT NULL UNIQUE
);

CREATE TABLE retencion (
    ret_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ret_referencia  VARCHAR(80)  NOT NULL UNIQUE,  -- reserva (UUID) u operación de la saga
    dis_id          BIGINT       NOT NULL,
    ret_cupos       INTEGER      NOT NULL,
    ret_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ret_liberado_en TIMESTAMPTZ,
    CONSTRAINT retencion_cupos_positivos CHECK (ret_cupos > 0),
    CONSTRAINT fk_retencion_disponibilidad
        FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_retencion_dis_id ON retencion (dis_id);

CREATE TABLE sync_stock (
    ss_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ss_item_id     UUID         NOT NULL,
    ss_fecha       DATE         NOT NULL,
    ss_turno       VARCHAR(12)  NOT NULL,          -- «10:30 a.m.»
    ss_disponibles INTEGER      NOT NULL,
    ss_motivo      VARCHAR(20)  NOT NULL,          -- VENTA, CANCELACION, AFORO
    ss_estado      VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
    ss_intentos    SMALLINT     NOT NULL DEFAULT 0,
    ss_latencia_ms INTEGER,
    ss_respuesta   VARCHAR(300),
    ss_correlacion VARCHAR(100),
    ss_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ss_enviado_en  TIMESTAMPTZ,
    CONSTRAINT sync_stock_estado_valido CHECK (ss_estado IN ('PENDIENTE', 'ENVIADO', 'ERROR', 'DESCARTADO'))
);
CREATE INDEX ix_sync_stock_pendiente ON sync_stock (ss_id) WHERE ss_estado IN ('PENDIENTE', 'ERROR');

CREATE TABLE evento (
    evt_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    evt_secuencia    BIGINT       GENERATED ALWAYS AS IDENTITY UNIQUE,
    evt_tipo         VARCHAR(40)  NOT NULL,
    evt_datos        JSONB        NOT NULL,
    evt_correlacion  VARCHAR(100),
    evt_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    evt_enviado_en   TIMESTAMPTZ,
    evt_intentos     SMALLINT     NOT NULL DEFAULT 0,
    evt_ultimo_error VARCHAR(300)
);
CREATE INDEX ix_evento_pendiente ON evento (evt_secuencia) WHERE evt_enviado_en IS NULL;

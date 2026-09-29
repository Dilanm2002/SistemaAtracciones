-- ============================================================================
--  DESCUBRE EC  ·  EVENTOS DE DOMINIO (diseño EDA · patrón Transactional Outbox)
-- ============================================================================
--  Cada cambio relevante del dominio (reserva creada, pago aprobado, reserva
--  cancelada, atracción publicada…) se guarda aquí EN LA MISMA TRANSACCIÓN que
--  el cambio de negocio: si la reserva se revierte, su evento también.
--
--  Hoy los otros sistemas consumen el feed GET /api/v1/eventos (pull con cursor
--  evt_id). En la migración a microservicios, un "relay" leerá las filas con
--  evt_publicado_en IS NULL, las publicará en el broker (Kafka / RabbitMQ) y las
--  marcará como publicadas. Contrato: backend/contracts/atracciones-asyncapi.yaml
--  Copia de documentación: database/03_eventos.sql
-- ============================================================================

CREATE TABLE evento (
    evt_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- cursor del feed
    evt_uuid         UUID         NOT NULL DEFAULT gen_random_uuid(),         -- id público (deduplicación)
    evt_tipo         VARCHAR(60)  NOT NULL,        -- atracciones.reserva.creada
    evt_version      SMALLINT     NOT NULL DEFAULT 1,
    evt_agregado     VARCHAR(40)  NOT NULL,        -- reserva, pago, atraccion
    evt_agregado_id  VARCHAR(64)  NOT NULL,        -- id público del agregado (UUID)
    evt_datos        JSONB        NOT NULL,
    evt_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    evt_publicado_en TIMESTAMPTZ,                  -- lo marca el relay al publicar en el broker
    CONSTRAINT uq_evento_uuid UNIQUE (evt_uuid),
    CONSTRAINT evento_tipo_valido CHECK (evt_tipo ~ '^[a-z]+(\.[a-z_]+)+$'),
    CONSTRAINT evento_version_valida CHECK (evt_version > 0)
);
CREATE INDEX ix_evento_pendiente ON evento (evt_id) WHERE evt_publicado_en IS NULL;
CREATE INDEX ix_evento_agregado  ON evento (evt_agregado, evt_agregado_id);
CREATE INDEX ix_evento_tipo      ON evento (evt_tipo, evt_id);

COMMENT ON TABLE evento IS 'Outbox de eventos de dominio de Atracciones (EDA). Contrato: atracciones-asyncapi.yaml';

-- Misma política que el resto del modelo (ver 002_seguridad.sql)
ALTER TABLE evento ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.evento FROM %I', rol);
        END IF;
    END LOOP;
END $$;

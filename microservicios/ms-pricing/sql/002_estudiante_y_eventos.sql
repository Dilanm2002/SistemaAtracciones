-- Extras de Descubre EC sobre la sección 6 del script del equipo (solo se AGREGA; avisar al equipo).
--  · Tarifa ESTUDIANTE: el contrato v2 final con Booking tiene `student_count` con precio propio.
--  · Outbox `evento`: PRECIO_ACTUALIZADO se publica a ms_catalog (proyección tarifa_vigente).

ALTER TABLE tarifa DROP CONSTRAINT tarifa_tipo_valido;
ALTER TABLE tarifa ADD CONSTRAINT tarifa_tipo_valido
    CHECK (tar_tipo IN ('ADULTO', 'NINO', 'MAYOR', 'GRUPO', 'ESTUDIANTE'));

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

-- ============================================================================
--  ms_review · 002 · NOTAS POR PILAR Y OUTBOX DE EVENTOS
-- ============================================================================
--  · El contrato v3 de Booking pide la calificación desglosada por pilares (limpieza, servicio,
--    calidad-precio y puntualidad). El script del equipo solo tiene ren_puntuacion: se agregan
--    cuatro notas opcionales (1 a 5). Sin nota de un pilar, cuenta la general.
--  · Outbox: RESENA_PUBLICADA se guarda en la MISMA transacción que la reseña y un despachador lo
--    envía a ms_catalog (y a quien se suscriba) con reintentos. Así no se pierde ni se inventa un evento.
--  Solo se AGREGAN columnas y tablas: lo del script del equipo no cambia.
-- ============================================================================

ALTER TABLE resena
    ADD COLUMN ren_limpieza       SMALLINT,
    ADD COLUMN ren_servicio       SMALLINT,
    ADD COLUMN ren_relacion_valor SMALLINT,
    ADD COLUMN ren_puntualidad    SMALLINT,
    ADD CONSTRAINT resena_pilares_validos CHECK (
        (ren_limpieza IS NULL OR ren_limpieza BETWEEN 1 AND 5) AND
        (ren_servicio IS NULL OR ren_servicio BETWEEN 1 AND 5) AND
        (ren_relacion_valor IS NULL OR ren_relacion_valor BETWEEN 1 AND 5) AND
        (ren_puntualidad IS NULL OR ren_puntualidad BETWEEN 1 AND 5));

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
CREATE INDEX ix_evento_pendientes ON evento (evt_secuencia) WHERE evt_enviado_en IS NULL;

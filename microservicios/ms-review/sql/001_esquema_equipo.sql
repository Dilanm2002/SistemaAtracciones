-- Copiado SIN CAMBIOS de 02_microservicios_v2_bases_de_datos.sql (script del equipo), sección 5.
--  5 · REVIEW SERVICE  (REST)
--  Tablas: resena
--  Referencias externas (ID logico): atr_id -> atraccion (Catalog),
--                                    usu_id -> usuario (Identity)
--  Publica el evento RESENA_PUBLICADA (reemplaza a trg_resena_calificacion).
-- ============================================================================

CREATE TABLE resena (
    ren_id           BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id           BIGINT        NOT NULL,        -- ID logico (Catalog)
    usu_id           BIGINT,                        -- ID logico (Identity); NULL = anonima
    ren_autor_nombre VARCHAR(120),                  -- solo para resenas anonimas
    ren_puntuacion   SMALLINT      NOT NULL,
    ren_comentario   VARCHAR(1000) NOT NULL,
    ren_visible      BOOLEAN       NOT NULL DEFAULT TRUE,
    ren_creado_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT resena_puntuacion_valida CHECK (ren_puntuacion BETWEEN 1 AND 5),
    CONSTRAINT uq_resena_atraccion_usuario UNIQUE (atr_id, usu_id),
    CONSTRAINT resena_autor_coherente
        CHECK ((usu_id IS NOT NULL AND ren_autor_nombre IS NULL)
            OR (usu_id IS NULL AND ren_autor_nombre IS NOT NULL))
);
CREATE INDEX ix_resena_atr_id ON resena (atr_id);
CREATE INDEX ix_resena_usu_id ON resena (usu_id);



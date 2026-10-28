-- ============================================================================
--  ms_catalog · 002 · CAMPOS QUE EXIGE EL CONTRATO v3 DE BOOKING
-- ============================================================================
--  El script del equipo (001) no los tiene y el contrato v3 los pide en el catálogo:
--   · banderas incluye_comida / incluye_transporte / incluye_guia (árbol de categorías y atracción);
--   · accesibilidad, animales de asistencia, guía e instrucciones de llegada (ficha);
--   · paquetes con Booking (permite_paquete, % de descuento);
--   · itinerario paso a paso (tabla nueva, 1-N con atraccion).
--  Proyecciones (datos de OTROS servicios que llegan por eventos; ms_catalog no es su dueño):
--   · notas por pilar de las reseñas (evento RESENA_PUBLICADA de ms_review), igual que el promedio;
--   · tarifa_vigente: precio vigente por tipo de boleto (evento PRECIO_ACTUALIZADO de ms_pricing),
--     como dice el diagrama del equipo: «Catalog recibe los precios por eventos para la búsqueda».
--  Solo se AGREGAN columnas y tablas: lo del script del equipo no cambia.
-- ============================================================================

ALTER TABLE categoria
    ADD COLUMN cat_incluye_comida     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cat_incluye_transporte BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cat_incluye_guia       BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE atraccion
    ADD COLUMN atr_incluye_comida        BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_incluye_transporte    BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_incluye_guia          BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_accesible_silla       BOOLEAN      NOT NULL DEFAULT FALSE,   -- silla de ruedas
    ADD COLUMN atr_accesible_coche       BOOLEAN      NOT NULL DEFAULT FALSE,   -- coche de bebé
    ADD COLUMN atr_animales_servicio     BOOLEAN      NOT NULL DEFAULT TRUE,    -- perros guía / asistencia
    ADD COLUMN atr_guia                  VARCHAR(150),                          -- guía oficial asignado
    ADD COLUMN atr_instrucciones_llegada VARCHAR(300),
    ADD COLUMN atr_permite_paquete       BOOLEAN      NOT NULL DEFAULT TRUE,    -- combos con Booking
    ADD COLUMN atr_descuento_paquete     NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Proyección de ms_review (evento RESENA_PUBLICADA), escala 1 a 5 como atr_calificacion_promedio
    ADD COLUMN atr_pilar_limpieza        NUMERIC(3,2),
    ADD COLUMN atr_pilar_servicio        NUMERIC(3,2),
    ADD COLUMN atr_pilar_relacion_valor  NUMERIC(3,2),
    ADD COLUMN atr_pilar_puntualidad     NUMERIC(3,2),
    ADD CONSTRAINT atraccion_descuento_paquete_valido CHECK (atr_descuento_paquete BETWEEN 0 AND 50),
    ADD CONSTRAINT atraccion_pilares_validos CHECK (
        (atr_pilar_limpieza IS NULL OR atr_pilar_limpieza BETWEEN 0 AND 5) AND
        (atr_pilar_servicio IS NULL OR atr_pilar_servicio BETWEEN 0 AND 5) AND
        (atr_pilar_relacion_valor IS NULL OR atr_pilar_relacion_valor BETWEEN 0 AND 5) AND
        (atr_pilar_puntualidad IS NULL OR atr_pilar_puntualidad BETWEEN 0 AND 5));

-- Itinerario: hitos en orden cronológico (1-N con atraccion)
CREATE TABLE atraccion_itinerario (
    iti_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id           BIGINT       NOT NULL,
    iti_orden        SMALLINT     NOT NULL,
    iti_hora         TIME         NOT NULL,
    iti_titulo       VARCHAR(150) NOT NULL,
    iti_descripcion  VARCHAR(500),
    iti_duracion_min SMALLINT     NOT NULL,
    iti_lugar        VARCHAR(150),
    CONSTRAINT uq_atraccion_itinerario_orden UNIQUE (atr_id, iti_orden),
    CONSTRAINT atraccion_itinerario_orden_valido CHECK (iti_orden > 0),
    CONSTRAINT atraccion_itinerario_duracion_valida CHECK (iti_duracion_min BETWEEN 1 AND 1440),
    CONSTRAINT fk_atraccion_itinerario_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_itinerario_atr_id ON atraccion_itinerario (atr_id);

-- Proyección de ms_pricing: precio vigente por tipo de boleto (lo reemplaza cada PRECIO_ACTUALIZADO)
CREATE TABLE tarifa_vigente (
    atr_id             BIGINT       NOT NULL,
    tav_tipo           VARCHAR(20)  NOT NULL,                 -- ADULTO, NINO, MAYOR, ESTUDIANTE, GRUPO
    tav_precio         NUMERIC(12,2) NOT NULL,
    tav_moneda         CHAR(3)      NOT NULL DEFAULT 'USD',
    tav_actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_tarifa_vigente PRIMARY KEY (atr_id, tav_tipo),
    CONSTRAINT tarifa_vigente_tipo_valido CHECK (tav_tipo IN ('ADULTO', 'NINO', 'MAYOR', 'ESTUDIANTE', 'GRUPO')),
    CONSTRAINT tarifa_vigente_precio_valido CHECK (tav_precio >= 0),
    CONSTRAINT fk_tarifa_vigente_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Inbox: eventos ya procesados (un evento repetido no se aplica dos veces)
CREATE TABLE evento_recibido (
    evr_id          UUID        PRIMARY KEY,
    evr_tipo        VARCHAR(40) NOT NULL,
    evr_recibido_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

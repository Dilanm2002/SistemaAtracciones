-- ============================================================================
--  DESCUBRE EC  ·  OBSERVABILIDAD (métricas, incidentes y Web Vitals)
-- ============================================================================
--  En Vercel cada instancia de la función vive poco y tiene su propia memoria:
--  los contadores en memoria se pierden y no se pueden sumar entre instancias.
--  Por eso las señales se guardan en la base, en el esquema `ops` (fuera de
--  `public`: no se mezclan con el modelo del negocio ni las expone Supabase):
--
--   ops.metrica_http  Peticiones agregadas por minuto, método, ruta (plantilla,
--                     sin ids) y código de estado: cantidad, suma, máximo y un
--                     histograma de duración para calcular p50 / p95 / p99.
--   ops.incidente     Errores 5xx de la API y errores de la web (excepciones,
--                     promesas rechazadas, fallos de render), con request_id
--                     para encontrarlos en los logs. Sin datos personales.
--   ops.web_vital     Core Web Vitals medidos en el navegador de los usuarios
--                     (LCP, INP, CLS, FCP, TTFB) por ruta y tipo de dispositivo.
--
--  Retención: 30 días (métricas y Web Vitals) y 90 días (incidentes); la API
--  borra lo antiguo sola (common/observabilidad/metricas-http.ts).
--  Copia de documentación: database/08_observabilidad.sql
-- ============================================================================

CREATE TABLE ops.metrica_http (
    mh_minuto     TIMESTAMPTZ  NOT NULL,              -- inicio del minuto (UTC)
    mh_metodo     VARCHAR(7)   NOT NULL,
    mh_ruta       VARCHAR(120) NOT NULL,              -- /atracciones/:id (nunca ids ni query string)
    mh_estado     SMALLINT     NOT NULL,              -- código HTTP
    mh_total      INTEGER      NOT NULL DEFAULT 0,
    mh_suma_ms    BIGINT       NOT NULL DEFAULT 0,
    mh_max_ms     INTEGER      NOT NULL DEFAULT 0,
    mh_db_ms      BIGINT       NOT NULL DEFAULT 0,    -- tiempo total en la base
    -- Histograma (cubetas NO acumuladas): ≤100, ≤250, ≤500, ≤1000, ≤2500 ms; el resto es > 2500 ms
    mh_c100       INTEGER      NOT NULL DEFAULT 0,
    mh_c250       INTEGER      NOT NULL DEFAULT 0,
    mh_c500       INTEGER      NOT NULL DEFAULT 0,
    mh_c1000      INTEGER      NOT NULL DEFAULT 0,
    mh_c2500      INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT pk_metrica_http PRIMARY KEY (mh_minuto, mh_metodo, mh_ruta, mh_estado),
    CONSTRAINT metrica_http_estado_valido CHECK (mh_estado BETWEEN 100 AND 599),
    CONSTRAINT metrica_http_cubetas_validas
        CHECK (mh_c100 + mh_c250 + mh_c500 + mh_c1000 + mh_c2500 <= mh_total)
);
CREATE INDEX ix_metrica_http_minuto ON ops.metrica_http (mh_minuto DESC);

CREATE TABLE ops.incidente (
    inc_id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inc_ocurrido_en TIMESTAMPTZ   NOT NULL DEFAULT now(),
    inc_origen      VARCHAR(3)    NOT NULL,           -- api | web
    inc_tipo        VARCHAR(20)   NOT NULL,           -- http_5xx, excepcion, promesa, render, api
    inc_huella      CHAR(16)      NOT NULL,           -- agrupa el mismo error (tipo + mensaje + ruta)
    inc_mensaje     VARCHAR(500)  NOT NULL,
    inc_ruta        VARCHAR(200),
    inc_metodo      VARCHAR(7),
    inc_estado      SMALLINT,
    inc_request_id  VARCHAR(64),
    inc_trace_id    VARCHAR(32),
    inc_version     VARCHAR(20),
    inc_navegador   VARCHAR(60),
    inc_detalle     VARCHAR(4000),                    -- pila de llamadas (recortada)
    CONSTRAINT incidente_origen_valido CHECK (inc_origen IN ('api', 'web')),
    CONSTRAINT incidente_tipo_valido CHECK (inc_tipo IN ('http_5xx', 'excepcion', 'promesa', 'render', 'api'))
);
CREATE INDEX ix_incidente_ocurrido_en ON ops.incidente (inc_ocurrido_en DESC);
CREATE INDEX ix_incidente_huella      ON ops.incidente (inc_huella, inc_ocurrido_en DESC);
CREATE INDEX ix_incidente_request_id  ON ops.incidente (inc_request_id);

CREATE TABLE ops.web_vital (
    wv_id           BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wv_medido_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    wv_nombre       VARCHAR(4)    NOT NULL,
    wv_valor        NUMERIC(10,3) NOT NULL,           -- ms (CLS: sin unidad)
    wv_calificacion VARCHAR(17)   NOT NULL,
    wv_ruta         VARCHAR(120)  NOT NULL,
    wv_dispositivo  VARCHAR(10)   NOT NULL,
    wv_version      VARCHAR(20),
    CONSTRAINT web_vital_nombre_valido CHECK (wv_nombre IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
    CONSTRAINT web_vital_valor_valido CHECK (wv_valor >= 0),
    CONSTRAINT web_vital_calificacion_valida CHECK (wv_calificacion IN ('good', 'needs-improvement', 'poor')),
    CONSTRAINT web_vital_dispositivo_valido CHECK (wv_dispositivo IN ('movil', 'escritorio'))
);
CREATE INDEX ix_web_vital_medido_en ON ops.web_vital (wv_medido_en DESC, wv_nombre);

COMMENT ON TABLE ops.metrica_http IS 'Peticiones HTTP agregadas por minuto con histograma de duración (observabilidad)';
COMMENT ON TABLE ops.incidente IS 'Errores 5xx de la API y errores de la web, con request_id; sin datos personales';
COMMENT ON TABLE ops.web_vital IS 'Core Web Vitals medidos en el navegador de los usuarios';

-- Misma política que el resto del modelo (ver 002_seguridad.sql): solo la API accede
ALTER TABLE ops.metrica_http ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.incidente    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.web_vital    ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA ops FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM %I', rol);
        END IF;
    END LOOP;
END $$;

-- ============================================================================
--  DESCUBRE EC  ·  EMPRESAS PROVEEDORAS (marketplace de tours y paquetes)
-- ============================================================================
--  Flujo de negocio:
--   1. Una persona con cuenta solicita que su empresa venda en Descubre EC
--      (solicitud_operador, estado PENDIENTE).
--   2. El administrador la aprueba —se crea el `operador` y el usuario pasa a
--      tener el rol OPERADOR de esa empresa— o la rechaza con un motivo.
--   3. El operador sube sus tours/paquetes: quedan EN_REVISION (no visibles).
--   4. El administrador los publica (PUBLICADA) o los rechaza (RECHAZADA, con
--      motivo); el operador corrige y vuelve a enviarlos a revisión.
--   5. Una experiencia ya aprobada (atr_aprobada) se puede pausar (INACTIVA) y
--      reactivar sin pasar otra vez por revisión.
--  Copia de documentación: database/06_proveedores.sql
-- ============================================================================

-- ── Estados de revisión de la atracción ────────────────────────────────────
ALTER TABLE atraccion DROP CONSTRAINT atraccion_estado_valido;
ALTER TABLE atraccion ADD CONSTRAINT atraccion_estado_valido
    CHECK (atr_estado IN ('BORRADOR', 'EN_REVISION', 'PUBLICADA', 'RECHAZADA', 'INACTIVA'));

ALTER TABLE atraccion
    ADD COLUMN atr_aprobada       BOOLEAN      NOT NULL DEFAULT FALSE,  -- alguna vez aprobada por el admin
    ADD COLUMN atr_motivo_rechazo VARCHAR(500),
    ADD COLUMN atr_creado_por     BIGINT,
    ADD COLUMN atr_revisado_por   BIGINT,
    ADD COLUMN atr_revisado_en    TIMESTAMPTZ,
    ADD CONSTRAINT atraccion_rechazo_con_motivo
        CHECK (atr_estado <> 'RECHAZADA' OR atr_motivo_rechazo IS NOT NULL),
    ADD CONSTRAINT fk_atraccion_creado_por
        FOREIGN KEY (atr_creado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    ADD CONSTRAINT fk_atraccion_revisado_por
        FOREIGN KEY (atr_revisado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX ix_atraccion_creado_por   ON atraccion (atr_creado_por);
CREATE INDEX ix_atraccion_revisado_por ON atraccion (atr_revisado_por);

-- Todo lo que ya estaba publicado o pausado se considera aprobado
UPDATE atraccion SET atr_aprobada = TRUE WHERE atr_estado IN ('PUBLICADA', 'INACTIVA');

COMMENT ON COLUMN atraccion.atr_aprobada IS 'TRUE si el administrador la aprobó alguna vez: el operador puede pausarla y reactivarla sin nueva revisión';

-- ── Solicitudes de empresas que quieren vender en la plataforma ────────────
CREATE TABLE solicitud_operador (
    sop_id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id             BIGINT       NOT NULL,              -- quien solicita (tendrá el rol OPERADOR)
    sop_empresa        VARCHAR(150) NOT NULL,              -- nombre comercial propuesto
    sop_ruc            dom_ruc      NOT NULL,
    prov_id            SMALLINT     NOT NULL,              -- provincia de la sede
    sop_correo         dom_correo   NOT NULL,              -- correo de reservas
    sop_telefono       dom_telefono NOT NULL,
    sop_direccion      VARCHAR(255),
    sop_descripcion    VARCHAR(1000) NOT NULL,             -- qué tours/paquetes ofrece
    sop_estado         VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
    sop_motivo_rechazo VARCHAR(500),
    ope_id             BIGINT,                             -- empresa creada al aprobar
    sop_revisado_por   BIGINT,
    sop_creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sop_revisado_en    TIMESTAMPTZ,
    CONSTRAINT solicitud_operador_estado_valido
        CHECK (sop_estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    CONSTRAINT solicitud_operador_rechazo_con_motivo
        CHECK (sop_estado <> 'RECHAZADA' OR sop_motivo_rechazo IS NOT NULL),
    CONSTRAINT solicitud_operador_aprobada_con_empresa
        CHECK (sop_estado <> 'APROBADA' OR ope_id IS NOT NULL),
    CONSTRAINT fk_solicitud_operador_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_solicitud_operador_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_solicitud_operador_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_operador_revisor
        FOREIGN KEY (sop_revisado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX ix_solicitud_operador_usu_id   ON solicitud_operador (usu_id);
CREATE INDEX ix_solicitud_operador_prov_id  ON solicitud_operador (prov_id);
CREATE INDEX ix_solicitud_operador_ope_id   ON solicitud_operador (ope_id);
CREATE INDEX ix_solicitud_operador_revisor  ON solicitud_operador (sop_revisado_por);
CREATE INDEX ix_solicitud_operador_estado   ON solicitud_operador (sop_estado, sop_creado_en);
-- Una sola solicitud pendiente por persona y por RUC
CREATE UNIQUE INDEX ux_solicitud_operador_usuario_pendiente ON solicitud_operador (usu_id)  WHERE sop_estado = 'PENDIENTE';
CREATE UNIQUE INDEX ux_solicitud_operador_ruc_pendiente     ON solicitud_operador (sop_ruc) WHERE sop_estado = 'PENDIENTE';

COMMENT ON TABLE solicitud_operador IS 'Empresas que piden vender sus tours/paquetes; el administrador las aprueba o rechaza';

-- Misma política que el resto del modelo (002_seguridad.sql): solo la API accede
ALTER TABLE solicitud_operador ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.solicitud_operador FROM %I', rol);
        END IF;
    END LOOP;
END $$;

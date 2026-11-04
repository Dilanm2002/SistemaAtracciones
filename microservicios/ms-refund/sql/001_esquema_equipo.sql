-- Copiado SIN CAMBIOS de 02_microservicios_v2_bases_de_datos.sql (script del equipo), sección 13.
--  13 · REFUND SERVICE  (REST)
--  Tablas: reembolso
--  Referencias externas (ID logico): pag_id -> pago (Payment)
--  Regla "no reembolsar mas de lo cobrado" (antes trg_reembolso_no_excede):
--  el servicio consulta a Payment el pag_monto antes de procesar.
-- ============================================================================

CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE TABLE reembolso (
    rem_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id            BIGINT      NOT NULL,         -- ID logico (Payment)
    rem_numero        VARCHAR(30) NOT NULL UNIQUE,
    rem_monto         dom_importe NOT NULL,
    rem_motivo        VARCHAR(300),
    rem_referencia    VARCHAR(100),                 -- id del reembolso en la pasarela
    rem_solicitado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    rem_procesado_en  TIMESTAMPTZ,
    rem_creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reembolso_monto_valido CHECK (rem_monto > 0)
);
CREATE INDEX ix_reembolso_pag_id ON reembolso (pag_id);

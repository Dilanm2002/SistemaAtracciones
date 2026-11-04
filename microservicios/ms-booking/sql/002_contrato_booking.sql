-- Extras de Descubre EC sobre la sección 11 del script del equipo (avisar al equipo). Casi todo se AGREGA;
-- dos reglas del script se AMPLÍAN porque el contrato con Booking pide más de lo que permiten:
--  · reserva_total_coherente: además de adultos y niños hay adultos mayores, estudiantes e infantes.
--  · dom_documento: el titular puede presentar RUC (13 dígitos) o un pasaporte alfanumérico (6–9).

-- ── Estado del check-in presencial (contrato v2/v3: CHECKED_IN) ──────────────
INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES ('CHECKED_IN', 'Titular presentado en el punto de encuentro', FALSE)
ON CONFLICT (est_codigo) DO NOTHING;

-- ── Tipos de boleto y datos de la reserva ───────────────────────────────────
ALTER TABLE reserva
    ADD COLUMN res_seniors            INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN res_estudiantes        INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN res_infantes           INTEGER      NOT NULL DEFAULT 0,  -- $0, pero ocupan cupo
    ADD COLUMN res_precio_nino        NUMERIC(12,2),
    ADD COLUMN res_precio_senior      NUMERIC(12,2),
    ADD COLUMN res_precio_estudiante  NUMERIC(12,2),
    ADD COLUMN res_fecha              DATE,                              -- copia del turno (ms_inventory)
    ADD COLUMN res_hora               TIME,
    ADD COLUMN res_origen             VARCHAR(10)  NOT NULL DEFAULT 'WEB',
    ADD COLUMN res_saga_id            VARCHAR(60),
    ADD COLUMN res_booking_ref        VARCHAR(80),                       -- booking_reservation_id de la guía
    ADD COLUMN res_checkin_en         TIMESTAMPTZ,
    ADD COLUMN res_checkin_guia       VARCHAR(60),
    ADD COLUMN res_checkin_dispositivo VARCHAR(80),
    -- IDs lógicos de los demás servicios (la saga los llena)
    ADD COLUMN ord_id                 BIGINT,                            -- Order
    ADD COLUMN ord_numero             VARCHAR(20),
    ADD COLUMN pag_id                 BIGINT,                            -- Payment
    -- Copia de la atracción al reservar (Catalog): la consulta de Booking no depende de otros servicios
    ADD COLUMN atr_id                 BIGINT,
    ADD COLUMN atr_uuid               UUID,
    ADD COLUMN atr_nombre             VARCHAR(200),
    ADD COLUMN res_punto_encuentro    VARCHAR(300),
    ADD COLUMN res_guia               VARCHAR(120),
    ADD COLUMN res_cancelacion_gratuita BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN res_horas_cancelacion  INTEGER      NOT NULL DEFAULT 24,
    ADD COLUMN res_moneda             CHAR(3)      NOT NULL DEFAULT 'USD',
    -- Estado del pago y del reembolso (Payment / Refund), para responder sin llamar a otros servicios
    ADD COLUMN res_metodo_pago        VARCHAR(20),
    ADD COLUMN res_pago_estado        VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
    ADD COLUMN res_reembolso_numero   VARCHAR(30),
    ADD COLUMN res_reembolso_monto    NUMERIC(12,2),
    ADD COLUMN res_factura_pendiente  BOOLEAN      NOT NULL DEFAULT FALSE,  -- se reintenta si ms_invoicing no respondió
    ADD CONSTRAINT reserva_tipos_validos CHECK (res_seniors >= 0 AND res_estudiantes >= 0 AND res_infantes >= 0),
    ADD CONSTRAINT reserva_origen_valido CHECK (res_origen IN ('WEB', 'BOOKING'));

ALTER TABLE reserva DROP CONSTRAINT reserva_total_coherente;
ALTER TABLE reserva ADD CONSTRAINT reserva_total_coherente
    CHECK (res_numero_tickets = res_adultos + res_ninos + res_seniors + res_estudiantes + res_infantes);
CREATE INDEX ix_reserva_atr_uuid ON reserva (atr_uuid);
CREATE INDEX ix_reserva_fecha ON reserva (res_fecha);
CREATE UNIQUE INDEX ux_reserva_ord_id ON reserva (ord_id) WHERE ord_id IS NOT NULL;

-- ── Pasajeros: tipo de documento, contacto y tipo de boleto ─────────────────
ALTER DOMAIN dom_documento DROP CONSTRAINT dom_documento_check;
ALTER DOMAIN dom_documento ADD CONSTRAINT dom_documento_check
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[0-9]{13}$' OR VALUE ~ '^[A-Z0-9]{6,9}$');
ALTER TABLE reserva_pasajero
    ADD COLUMN pax_tipo_documento VARCHAR(10) NOT NULL DEFAULT 'CEDULA',
    ADD COLUMN pax_correo         VARCHAR(160),
    ADD COLUMN pax_telefono       VARCHAR(20),
    ADD COLUMN pax_tipo_boleto    VARCHAR(10) NOT NULL DEFAULT 'ADULT',
    ADD CONSTRAINT pasajero_tipo_documento_valido CHECK (pax_tipo_documento IN ('CEDULA', 'PASAPORTE', 'RUC')),
    ADD CONSTRAINT pasajero_tipo_boleto_valido CHECK (pax_tipo_boleto IN ('ADULT', 'CHILD', 'SENIOR', 'STUDENT', 'INFANT'));

-- ── Idempotency-Key de las operaciones de Booking (misma estructura que la de ms_order) ──
CREATE TABLE idempotencia (
    idem_clave        VARCHAR(80)  NOT NULL,
    idem_sujeto       VARCHAR(40)  NOT NULL,
    idem_operacion    VARCHAR(150) NOT NULL,
    idem_request_hash VARCHAR(64)  NOT NULL,
    idem_estado       VARCHAR(12)  NOT NULL DEFAULT 'IN_PROGRESS',
    idem_response     JSONB,
    idem_expira_en    TIMESTAMPTZ  NOT NULL,
    idem_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotencia PRIMARY KEY (idem_clave, idem_sujeto),
    CONSTRAINT idempotencia_estado_valido CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_expira_en ON idempotencia (idem_expira_en);

-- ── Feed de eventos del contrato (GET /atracciones/eventos) ─────────────────
-- Eventos propios (reservas, pagos) y los que llegan de ms_inventory (STOCK_ACTUALIZADO). evt_id es el
-- sequence_number que Booking usa en `after`: se conserva al copiar los de la tienda.
CREATE TABLE evento (
    evt_id          BIGINT       GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    evt_uuid        UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    evt_tipo        VARCHAR(60)  NOT NULL,
    evt_agregado    VARCHAR(30)  NOT NULL,
    evt_agregado_id VARCHAR(80)  NOT NULL,
    evt_datos       JSONB        NOT NULL,
    evt_correlacion VARCHAR(100),
    evt_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_evento_tipo ON evento (evt_tipo, evt_id);

-- ── Parámetros (p. ej. el usuario técnico de Booking, dueño de sus órdenes) ──
CREATE TABLE parametro (
    par_clave VARCHAR(60)  PRIMARY KEY,
    par_valor VARCHAR(200) NOT NULL
);

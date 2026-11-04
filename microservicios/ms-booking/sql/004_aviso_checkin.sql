-- Contrato v3.1: tras el check-in presencial se avisa a Booking y se reintenta si no responde.
--  · res_aviso_checkin: NULL (no aplica: la reserva no vino de Booking) · PENDIENTE · ENVIADO · FALLIDO.
ALTER TABLE reserva
    ADD COLUMN res_aviso_checkin        VARCHAR(10),
    ADD COLUMN res_aviso_intentos       SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN res_aviso_intento_en     TIMESTAMPTZ,
    ADD COLUMN res_aviso_respuesta      VARCHAR(300),
    ADD COLUMN res_checkin_admin        VARCHAR(120),
    ADD COLUMN res_checkin_asistentes   SMALLINT,
    ADD COLUMN res_checkin_observaciones VARCHAR(500),
    ADD CONSTRAINT reserva_aviso_checkin_valido CHECK (res_aviso_checkin IN ('PENDIENTE', 'ENVIADO', 'FALLIDO'));
CREATE INDEX ix_reserva_aviso_pendiente ON reserva (res_id) WHERE res_aviso_checkin = 'PENDIENTE';

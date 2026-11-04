-- Contrato v3.1 con Booking: turistas registrados con /api/v3/clientes.
--  · usu_origen: de dónde viene la persona (la tienda web o Booking).
--  · dom_documento: Booking también envía RUC y pasaportes alfanuméricos.
--  · usu_password: un turista de Booking no tiene contraseña; se guarda «!», que nunca es un hash bcrypt
--    válido, así que esa cuenta no puede iniciar sesión.
ALTER TABLE usuario ADD COLUMN usu_origen VARCHAR(10) NOT NULL DEFAULT 'WEB'
    CONSTRAINT usuario_origen_valido CHECK (usu_origen IN ('WEB', 'BOOKING'));
CREATE INDEX ix_usuario_creado_en ON usuario (usu_creado_en DESC);

ALTER DOMAIN dom_documento DROP CONSTRAINT dom_documento_check;
ALTER DOMAIN dom_documento ADD CONSTRAINT dom_documento_check CHECK (VALUE ~ '^[A-Z0-9]{5,20}$');

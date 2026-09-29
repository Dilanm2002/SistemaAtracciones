-- ============================================================================
--  DESCUBRE EC  ·  CONTACTO DEL PASAJERO TITULAR
-- ============================================================================
--  El formulario de reserva pide un correo y un teléfono de contacto
--  (customer_email / customer_phone del contrato), que pueden ser distintos
--  de los de la cuenta (p. ej. se reserva para un familiar). Antes se validaban
--  y se descartaban. Se guardan con el resto de la PII del pasajero, en
--  reserva_pasajero y no en reserva (V-11 de 02_verificacion.sql).
--  Si no se envían, la API muestra el correo y el teléfono de la cuenta.
--  Copia de documentación: database/05_contacto_pasajero.sql
-- ============================================================================

ALTER TABLE reserva_pasajero
    ADD COLUMN IF NOT EXISTS pax_correo   dom_correo,
    ADD COLUMN IF NOT EXISTS pax_telefono dom_telefono;

COMMENT ON COLUMN reserva_pasajero.pax_correo   IS 'Correo de contacto de la reserva (NULL = el de la cuenta)';
COMMENT ON COLUMN reserva_pasajero.pax_telefono IS 'Teléfono de contacto de la reserva (NULL = el de la cuenta)';

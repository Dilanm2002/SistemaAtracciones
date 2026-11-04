-- Extras de Descubre EC sobre la sección 12 del script del equipo (solo se AGREGA; avisar al equipo).
--  · Método SOA_BOOKING_GATEWAY: en el contrato v2/v3 Booking cobra en su propia pasarela y la reserva
--    llega pagada (payment_method = SOA_BOOKING_GATEWAY, o PAYPAL/CREDIT_CARD del objeto v3).
INSERT INTO metodo_pago (mpa_codigo, mpa_nombre, mpa_requiere_datos)
VALUES ('SOA_BOOKING_GATEWAY', 'Pasarela de pago de Booking Prototipo', FALSE)
ON CONFLICT (mpa_codigo) DO NOTHING;

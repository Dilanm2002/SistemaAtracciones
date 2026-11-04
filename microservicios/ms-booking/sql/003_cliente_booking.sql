-- Contrato v3.1: Booking envía el client_id del turista al reservar (lo liga con /clientes y con el check-in).
ALTER TABLE reserva ADD COLUMN res_client_id VARCHAR(64);

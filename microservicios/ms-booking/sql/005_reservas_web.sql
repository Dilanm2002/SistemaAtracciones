-- Compras de la web: cada reserva guarda a su dueño para «Mis reservas» (ID lógico → ms_identity / tienda).
ALTER TABLE reserva ADD COLUMN res_usu_id VARCHAR(64);
CREATE INDEX ix_reserva_usu_id ON reserva (res_usu_id) WHERE res_usu_id IS NOT NULL;
CREATE INDEX ix_reserva_atr_id ON reserva (atr_id);

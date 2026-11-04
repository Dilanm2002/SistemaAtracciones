-- Una base por microservicio (database-per-service) y su copia para las pruebas.
-- Nombres del script del equipo (02_microservicios_v2_bases_de_datos.sql).
-- Solo corre al crear el volumen; con un volumen existente: docker exec … psql -f (ver README).
CREATE DATABASE ms_location  ENCODING 'UTF8';
CREATE DATABASE ms_catalog   ENCODING 'UTF8';
CREATE DATABASE ms_review    ENCODING 'UTF8';
CREATE DATABASE ms_pricing   ENCODING 'UTF8';
CREATE DATABASE ms_inventory ENCODING 'UTF8';
CREATE DATABASE ms_coupon    ENCODING 'UTF8';
CREATE DATABASE ms_order     ENCODING 'UTF8';
CREATE DATABASE ms_booking   ENCODING 'UTF8';
CREATE DATABASE ms_payment   ENCODING 'UTF8';
CREATE DATABASE ms_refund    ENCODING 'UTF8';
CREATE DATABASE ms_invoicing ENCODING 'UTF8';
CREATE DATABASE ms_location_test  ENCODING 'UTF8';
CREATE DATABASE ms_catalog_test   ENCODING 'UTF8';
CREATE DATABASE ms_review_test    ENCODING 'UTF8';
CREATE DATABASE ms_pricing_test   ENCODING 'UTF8';
CREATE DATABASE ms_inventory_test ENCODING 'UTF8';
CREATE DATABASE ms_coupon_test    ENCODING 'UTF8';
CREATE DATABASE ms_order_test     ENCODING 'UTF8';
CREATE DATABASE ms_booking_test   ENCODING 'UTF8';
CREATE DATABASE ms_payment_test   ENCODING 'UTF8';
CREATE DATABASE ms_refund_test    ENCODING 'UTF8';
CREATE DATABASE ms_invoicing_test ENCODING 'UTF8';

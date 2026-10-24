-- ============================================================================
--  DESCUBRE EC  ·  INTEGRACIÓN CON BOOKING PROTOTIPO (contrato v2, RDA2)
-- ============================================================================
--  Lo que pide contracts/atracciones-openapi-v2.yaml y no existía en el modelo:
--   · Categorías con banderas de inclusión (comida, transporte, guía).
--   · Atracción: inclusiones, accesibilidad, guía asignado, instrucciones de
--     llegada, paquetes/combos y su itinerario paso a paso.
--   · Reseñas con nota por pilar (limpieza, servicio, calidad-precio, puntualidad).
--   · Reserva por tipo de boleto (adulto, niño, senior, infante), origen
--     (web o Booking), id de la saga y check-in presencial.
--   · Pasajero con tipo de documento (cédula, pasaporte, RUC) y teléfono E.164.
--   · Acuerdo comercial B2B de promociones (una fila) y sus destinos.
--   · Correlation id en los eventos del outbox.
--   · Usuario técnico «Booking Prototipo» dueño de las órdenes que llegan por v2.
--   · ops.sync_stock: cada envío gRPC de stock a Booking (CE01) y su resultado.
--  Los datos de demostración los completa atraccion_completar_v2() (idempotente).
--  Copia de documentación: database/09_integracion_booking_v2.sql
-- ============================================================================

-- ── Categorías: banderas de inclusión ──────────────────────────────────────
ALTER TABLE categoria
    ADD COLUMN cat_incluye_comida     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cat_incluye_transporte BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cat_incluye_guia       BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Atracción: inclusiones, accesibilidad, guía y paquetes ─────────────────
ALTER TABLE atraccion
    ADD COLUMN atr_incluye_comida      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_incluye_transporte  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_incluye_guia        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN atr_accesible_silla     BOOLEAN NOT NULL DEFAULT FALSE,  -- silla de ruedas
    ADD COLUMN atr_accesible_coche     BOOLEAN NOT NULL DEFAULT FALSE,  -- coche de bebé
    ADD COLUMN atr_animales_servicio   BOOLEAN NOT NULL DEFAULT TRUE,   -- perros guía / asistencia
    ADD COLUMN atr_guia                VARCHAR(150),                    -- guía oficial asignado
    ADD COLUMN atr_instrucciones_llegada VARCHAR(300),
    ADD COLUMN atr_permite_paquete     BOOLEAN NOT NULL DEFAULT TRUE,   -- combos con Booking
    ADD COLUMN atr_descuento_paquete   dom_porcentaje NOT NULL DEFAULT 0,
    ADD CONSTRAINT atraccion_descuento_paquete_valido CHECK (atr_descuento_paquete BETWEEN 0 AND 50);

-- Itinerario: hitos en orden cronológico
CREATE TABLE atraccion_itinerario (
    iti_id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id            BIGINT       NOT NULL,
    iti_orden         SMALLINT     NOT NULL,
    iti_hora          TIME         NOT NULL,
    iti_titulo        VARCHAR(150) NOT NULL,
    iti_descripcion   VARCHAR(500),
    iti_duracion_min  SMALLINT     NOT NULL,
    iti_lugar         VARCHAR(150),
    CONSTRAINT uq_atraccion_itinerario_orden UNIQUE (atr_id, iti_orden),
    CONSTRAINT atraccion_itinerario_orden_valido CHECK (iti_orden > 0),
    CONSTRAINT atraccion_itinerario_duracion_valida CHECK (iti_duracion_min BETWEEN 1 AND 1440),
    CONSTRAINT fk_atraccion_itinerario_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_itinerario_atr_id ON atraccion_itinerario (atr_id);

-- ── Reseñas: nota por pilar (1 a 5, como la nota general; la API v2 las muestra sobre 10) ──
ALTER TABLE resena
    ADD COLUMN ren_limpieza       SMALLINT,
    ADD COLUMN ren_servicio       SMALLINT,
    ADD COLUMN ren_relacion_valor SMALLINT,
    ADD COLUMN ren_puntualidad    SMALLINT,
    ADD CONSTRAINT resena_pilares_validos CHECK (
        (ren_limpieza IS NULL OR ren_limpieza BETWEEN 1 AND 5) AND
        (ren_servicio IS NULL OR ren_servicio BETWEEN 1 AND 5) AND
        (ren_relacion_valor IS NULL OR ren_relacion_valor BETWEEN 1 AND 5) AND
        (ren_puntualidad IS NULL OR ren_puntualidad BETWEEN 1 AND 5));

-- ── Reserva: tipos de boleto, origen, saga y check-in ──────────────────────
ALTER TABLE reserva DROP CONSTRAINT reserva_total_coherente;
ALTER TABLE reserva DROP CONSTRAINT reserva_pasajeros_validos;
ALTER TABLE reserva
    ADD COLUMN res_seniors          INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN res_infantes         INTEGER     NOT NULL DEFAULT 0,   -- tarifa $0, pero ocupan cupo
    ADD COLUMN res_precio_nino      dom_importe,                      -- snapshot por tipo
    ADD COLUMN res_precio_senior    dom_importe,
    ADD COLUMN res_origen           VARCHAR(10) NOT NULL DEFAULT 'WEB',
    ADD COLUMN res_saga_id          VARCHAR(60),
    ADD COLUMN res_checkin_en       TIMESTAMPTZ,
    ADD COLUMN res_checkin_guia     VARCHAR(60),
    ADD COLUMN res_checkin_dispositivo VARCHAR(60),
    ADD CONSTRAINT reserva_pasajeros_validos
        CHECK (res_adultos > 0 AND res_ninos >= 0 AND res_seniors >= 0 AND res_infantes >= 0),
    ADD CONSTRAINT reserva_total_coherente
        CHECK (res_numero_tickets = res_adultos + res_ninos + res_seniors + res_infantes),
    ADD CONSTRAINT reserva_origen_valido CHECK (res_origen IN ('WEB', 'BOOKING')),
    ADD CONSTRAINT reserva_checkin_coherente CHECK (res_checkin_en IS NOT NULL OR res_checkin_guia IS NULL);
CREATE INDEX ix_reserva_saga_id ON reserva (res_saga_id) WHERE res_saga_id IS NOT NULL;

-- Pasajero: documento según su tipo (cédula con dígito verificador, pasaporte o RUC),
-- teléfono ecuatoriano o internacional E.164, y tipo de boleto de cada acompañante
ALTER TABLE reserva_pasajero ALTER COLUMN pax_documento TYPE VARCHAR(20);
ALTER TABLE reserva_pasajero ALTER COLUMN pax_telefono TYPE VARCHAR(16);
ALTER TABLE reserva_pasajero
    ADD COLUMN pax_tipo_documento VARCHAR(10) NOT NULL DEFAULT 'CEDULA',
    ADD COLUMN pax_tipo_boleto    VARCHAR(6),
    ADD CONSTRAINT reserva_pasajero_tipo_documento_valido CHECK (pax_tipo_documento IN ('CEDULA', 'PASAPORTE', 'RUC')),
    ADD CONSTRAINT reserva_pasajero_documento_valido CHECK (
        pax_documento IS NULL
        OR (pax_tipo_documento = 'CEDULA' AND fn_cedula_ec_valida(pax_documento))
        OR (pax_tipo_documento = 'PASAPORTE' AND pax_documento ~ '^[A-Z0-9]{6,9}$')
        OR (pax_tipo_documento = 'RUC' AND pax_documento ~ '^[0-9]{13}$')),
    ADD CONSTRAINT reserva_pasajero_telefono_valido CHECK (
        pax_telefono IS NULL OR pax_telefono ~ '^(09[0-9]{8}|0[2-7][0-9]{7}|\+[1-9][0-9]{7,14})$'),
    ADD CONSTRAINT reserva_pasajero_tipo_boleto_valido CHECK (pax_tipo_boleto IS NULL OR pax_tipo_boleto IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT'));

-- ── Catálogos: estado de check-in y la pasarela de Booking ─────────────────
INSERT INTO estado (est_codigo, est_nombre, est_grupo, est_final) VALUES
    ('CHECKED_IN', 'Check-in realizado', 'RESERVA', TRUE)
ON CONFLICT (est_codigo) DO NOTHING;
INSERT INTO metodo_pago (mpa_codigo, mpa_nombre, mpa_requiere_datos) VALUES
    ('SOA_BOOKING_GATEWAY', 'Pasarela de pagos de Booking Prototipo (SOA)', FALSE)
ON CONFLICT (mpa_codigo) DO NOTHING;

-- ── Outbox: correlation id para seguir la transacción entre sistemas ──────
ALTER TABLE evento ADD COLUMN evt_correlacion VARCHAR(64);

-- ── Usuario técnico: dueño de las órdenes que llegan de Booking ────────────
--  No puede iniciar sesión (inactivo y sin contraseña válida). Los datos del
--  cliente real van en reserva_pasajero, como en cualquier reserva.
INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_verificado, usu_activo)
VALUES ('integracion.booking@descubre-ec.com', '!sin-acceso', 'Booking', 'Prototipo', TRUE, FALSE)
ON CONFLICT (usu_correo) DO NOTHING;
INSERT INTO usuario_rol (usu_id, rol_id)
SELECT u.usu_id, r.rol_id FROM usuario u, rol r
 WHERE u.usu_correo = 'integracion.booking@descubre-ec.com' AND r.rol_nombre = 'CLIENTE'
ON CONFLICT DO NOTHING;

-- ── Acuerdo comercial B2B de promociones (una sola fila) ───────────────────
CREATE TABLE acuerdo_promocion (
    apr_id               SMALLINT     PRIMARY KEY DEFAULT 1,
    apr_permite          BOOLEAN      NOT NULL,
    apr_descuento_maximo dom_porcentaje NOT NULL,
    apr_fecha_acuerdo    DATE         NOT NULL DEFAULT CURRENT_DATE,
    apr_vigencia_hasta   DATE         NOT NULL,
    apr_condiciones      VARCHAR(500),
    apr_contacto_nombre  VARCHAR(120),
    apr_contacto_correo  dom_correo,
    apr_contacto_telefono VARCHAR(16),
    apr_actualizado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT acuerdo_promocion_unico CHECK (apr_id = 1),
    CONSTRAINT acuerdo_promocion_descuento_valido CHECK (apr_descuento_maximo BETWEEN 0 AND 50),
    CONSTRAINT acuerdo_promocion_sin_descuento CHECK (apr_permite OR apr_descuento_maximo = 0)
);
CREATE TABLE acuerdo_promocion_destino (
    apd_id      INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apr_id      SMALLINT    NOT NULL,
    apd_destino VARCHAR(80) NOT NULL,
    CONSTRAINT uq_acuerdo_promocion_destino UNIQUE (apr_id, apd_destino),
    CONSTRAINT fk_acuerdo_promocion_destino_acuerdo
        FOREIGN KEY (apr_id) REFERENCES acuerdo_promocion (apr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_acuerdo_promocion_destino_apr_id ON acuerdo_promocion_destino (apr_id);

INSERT INTO acuerdo_promocion (apr_permite, apr_descuento_maximo, apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones,
                               apr_contacto_nombre, apr_contacto_correo)
VALUES (TRUE, 15.00, CURRENT_DATE, DATE '2027-12-31',
        'Aplica en paquetes de al menos 2 servicios en la misma ciudad de destino, con un mínimo de 48 horas de anticipación.',
        'Descubre EC', 'reservas@descubre-ec.com');
INSERT INTO acuerdo_promocion_destino (apr_id, apd_destino)
VALUES (1, 'Quito'), (1, 'Baños de Agua Santa'), (1, 'Cuenca'), (1, 'Puerto Ayora');

-- ── ops.sync_stock: envíos gRPC del stock a Booking (CE01) ─────────────────
CREATE TABLE ops.sync_stock (
    ss_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ss_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ss_item_id     VARCHAR(64)  NOT NULL,          -- atr_uuid
    ss_fecha       DATE         NOT NULL,
    ss_turno       VARCHAR(12)  NOT NULL,          -- «10:30 a.m.»
    ss_disponibles INTEGER      NOT NULL,
    ss_motivo      VARCHAR(20)  NOT NULL,          -- VENTA, CANCELACION, CHECKIN, AFORO
    ss_estado      VARCHAR(10)  NOT NULL DEFAULT 'PENDIENTE',
    ss_intentos    SMALLINT     NOT NULL DEFAULT 0,
    ss_latencia_ms INTEGER,
    ss_respuesta   VARCHAR(300),
    ss_enviado_en  TIMESTAMPTZ,
    ss_correlacion VARCHAR(64),
    CONSTRAINT sync_stock_estado_valido CHECK (ss_estado IN ('PENDIENTE', 'ENVIADO', 'ERROR', 'DESCARTADO')),
    CONSTRAINT sync_stock_disponibles_valido CHECK (ss_disponibles >= 0)
);
CREATE INDEX ix_sync_stock_pendientes ON ops.sync_stock (ss_creado_en) WHERE ss_estado IN ('PENDIENTE', 'ERROR');
CREATE INDEX ix_sync_stock_creado_en ON ops.sync_stock (ss_creado_en DESC);

-- ── Detalle de factura con los 4 tipos de boleto ───────────────────────────
--  Reemplaza la versión de 007: una línea por tipo de boleto con su precio
--  congelado en la reserva. En las reservas anteriores a esta migración (sin
--  precio por tipo) los niños siguen siendo «el resto del subtotal».
CREATE OR REPLACE FUNCTION factura_generar_detalle(p_fac_id BIGINT) RETURNS INTEGER
LANGUAGE sql AS $$
    WITH f AS (
        SELECT fa.fac_id, o.ord_id,
               CASE WHEN o.ord_subtotal > 0 THEN round(o.ord_iva * 100 / o.ord_subtotal, 2) ELSE 0 END AS tarifa
          FROM factura fa JOIN orden o ON o.ord_id = fa.ord_id
         WHERE fa.fac_id = p_fac_id
           AND NOT EXISTS (SELECT 1 FROM factura_detalle x WHERE x.fac_id = fa.fac_id)
    ),
    r AS (
        SELECT f.fac_id, f.tarifa, dt.det_id, dt.det_descripcion, a.atr_id, dt.det_cantidad, dt.det_precio_unitario, dt.det_subtotal,
               re.res_adultos, re.res_ninos, re.res_seniors, re.res_infantes, re.res_precio_unitario, re.res_precio_nino,
               re.res_precio_senior, re.res_subtotal,
               CASE WHEN re.res_precio_nino IS NOT NULL OR re.res_seniors > 0 THEN round(re.res_adultos * re.res_precio_unitario, 2)
                    WHEN re.res_ninos = 0 THEN re.res_subtotal
                    ELSE LEAST(round(re.res_adultos * re.res_precio_unitario, 2), re.res_subtotal) END AS base_adultos
          FROM f
          JOIN orden_detalle dt ON dt.ord_id = f.ord_id
          JOIN atraccion a      ON a.atr_id = dt.atr_id
          LEFT JOIN reserva re  ON re.det_id = dt.det_id
    ),
    lineas AS (
        SELECT fac_id, tarifa, det_id, 1 AS tipo,
               'ATR-' || atr_id || CASE WHEN res_adultos IS NULL THEN '' ELSE '-AD' END AS codigo,
               det_descripcion || CASE WHEN res_adultos IS NULL THEN '' ELSE ' · Adulto' END AS descripcion,
               COALESCE(res_adultos, det_cantidad) AS cantidad,
               COALESCE(res_precio_unitario, det_precio_unitario) AS precio,
               COALESCE(base_adultos, det_subtotal) AS base
          FROM r
        UNION ALL
        SELECT fac_id, tarifa, det_id, 2, 'ATR-' || atr_id || '-NI', det_descripcion || ' · Niño', res_ninos,
               COALESCE(res_precio_nino, round((res_subtotal - base_adultos) / res_ninos, 2)),
               CASE WHEN res_precio_nino IS NOT NULL THEN round(res_ninos * res_precio_nino, 2)
                    ELSE res_subtotal - base_adultos - round(res_seniors * COALESCE(res_precio_senior, 0), 2) END
          FROM r WHERE res_ninos > 0
        UNION ALL
        SELECT fac_id, tarifa, det_id, 3, 'ATR-' || atr_id || '-SE', det_descripcion || ' · Adulto mayor', res_seniors,
               res_precio_senior, round(res_seniors * res_precio_senior, 2)
          FROM r WHERE res_seniors > 0
        UNION ALL
        SELECT fac_id, tarifa, det_id, 4, 'ATR-' || atr_id || '-IN', det_descripcion || ' · Infante', res_infantes, 0, 0
          FROM r WHERE res_infantes > 0
    ),
    ins AS (
        INSERT INTO factura_detalle (fac_id, fde_linea, det_id, fde_codigo, fde_descripcion, fde_cantidad, fde_precio_unitario,
                                     fde_descuento, fde_base_imponible, fde_tarifa_iva, fde_valor_iva, fde_total)
        SELECT fac_id, ROW_NUMBER() OVER (ORDER BY det_id, tipo), det_id, left(codigo, 25), left(descripcion, 255), cantidad, precio,
               0, base, tarifa, round(base * tarifa / 100, 2), base + round(base * tarifa / 100, 2)
          FROM lineas
        RETURNING 1
    )
    SELECT COUNT(*)::int FROM ins;
$$;

-- ── Datos de demostración (idempotente) ────────────────────────────────────
--  Completa lo que falte en cada atracción sin itinerario: tarifa senior (60 % del
--  adulto), banderas de inclusión, accesibilidad, guía, instrucciones de llegada e
--  itinerario de ejemplo. Lo usan esta migración (producción) y el seed (base nueva).
CREATE FUNCTION atraccion_completar_v2() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    a          RECORD;
    v_hora     TIME;
    v_total    INTEGER;
    v_comida   BOOLEAN;
    v_principal INTEGER;
    n          INTEGER := 0;
    guias      TEXT[] := ARRAY[
        'Lic. Carlos Morales (Credencial Mintur #5541)', 'Lic. Andrea Quishpe (Credencial Mintur #4120)',
        'Lic. Jorge Andrade (Credencial Mintur #3987)', 'Lic. Daniela Cevallos (Credencial Mintur #6203)',
        'Lic. Luis Tipán (Credencial Mintur #5178)', 'Lic. María José Vera (Credencial Mintur #4766)'];
BEGIN
    -- Banderas de categoría por slug (solo las conocidas; el resto queda como esté)
    UPDATE categoria c SET cat_incluye_comida = x.co, cat_incluye_transporte = x.tr, cat_incluye_guia = x.gu
      FROM (VALUES ('naturales', FALSE, TRUE, TRUE), ('aventura', FALSE, TRUE, TRUE), ('cultural', FALSE, FALSE, TRUE),
                   ('vida-silvestre', TRUE, TRUE, TRUE), ('playas', FALSE, TRUE, FALSE), ('tours-ciudad', FALSE, TRUE, TRUE),
                   ('trenes-miradores', FALSE, TRUE, TRUE), ('gastronomia', TRUE, FALSE, TRUE), ('montana', TRUE, TRUE, TRUE))
           AS x(slug, co, tr, gu)
     WHERE c.cat_slug = x.slug
       AND NOT (c.cat_incluye_comida OR c.cat_incluye_transporte OR c.cat_incluye_guia);

    FOR a IN
        SELECT at.atr_id, at.atr_nombre, at.atr_duracion_horas, COALESCE(at.atr_punto_encuentro, at.atr_direccion, 'el punto de encuentro') AS punto,
               ci.ciu_nombre AS ciudad, ci.prov_id
          FROM atraccion at JOIN ciudad ci ON ci.ciu_id = at.ciu_id
         WHERE NOT EXISTS (SELECT 1 FROM atraccion_itinerario it WHERE it.atr_id = at.atr_id)
         ORDER BY at.atr_id
    LOOP
        -- Tarifa senior: 60 % del adulto vigente (si no tiene una)
        INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde)
        SELECT t.atr_id, 'MAYOR', round(t.tar_precio * 0.6, 2), t.tar_moneda, t.tar_vigente_desde
          FROM tarifa t
         WHERE t.atr_id = a.atr_id AND t.tar_tipo = 'ADULTO' AND t.tar_vigente_hasta IS NULL
           AND NOT EXISTS (SELECT 1 FROM tarifa m WHERE m.atr_id = a.atr_id AND m.tar_tipo = 'MAYOR')
         ORDER BY t.tar_vigente_desde DESC LIMIT 1;

        -- Inclusiones: por lo que la atracción declara incluir; si no declara nada, por sus categorías
        UPDATE atraccion at SET
            atr_incluye_comida = COALESCE(inc.co, cat.co, FALSE),
            atr_incluye_transporte = COALESCE(inc.tr, cat.tr, FALSE),
            atr_incluye_guia = COALESCE(inc.gu, cat.gu, FALSE)
          FROM (SELECT bool_or(n.inc_nombre ~* '(almuerzo|comida|refrigerio|snack|degustaci|desayuno|cena|box lunch|bebida)') AS co,
                       bool_or(n.inc_nombre ~* '(transporte|traslado|bus|lancha|tren|vehículo|movilización|transfer)') AS tr,
                       bool_or(n.inc_nombre ~* '(guía|guia|naturalista)') AS gu
                  FROM atraccion_inclusion an JOIN inclusion n ON n.inc_id = an.inc_id
                 WHERE an.atr_id = a.atr_id AND n.inc_tipo = 'INCLUYE' HAVING COUNT(*) > 0) inc
          FULL JOIN (SELECT bool_or(c.cat_incluye_comida) AS co, bool_or(c.cat_incluye_transporte) AS tr, bool_or(c.cat_incluye_guia) AS gu
                       FROM atraccion_categoria ac JOIN categoria c ON c.cat_id = ac.cat_id WHERE ac.atr_id = a.atr_id) cat ON TRUE
         WHERE at.atr_id = a.atr_id;

        -- Accesibilidad: recorridos urbanos, museos y trenes sí; montaña, selva y mar no.
        -- En Galápagos (prov. 20) el parque nacional no admite animales.
        UPDATE atraccion at SET
            atr_accesible_silla = x.urbano,
            atr_accesible_coche = x.urbano,
            atr_animales_servicio = COALESCE(a.prov_id <> (SELECT prov_id FROM provincia WHERE prov_nombre = 'Galápagos' LIMIT 1), TRUE),
            atr_guia = COALESCE(at.atr_guia, guias[1 + (a.atr_id % array_length(guias, 1))]),
            atr_instrucciones_llegada = COALESCE(at.atr_instrucciones_llegada,
                left(format('Preséntate 15 minutos antes en %s con tu documento de identidad y el código QR de tu voucher.', a.punto), 300)),
            atr_descuento_paquete = CASE WHEN at.atr_descuento_paquete = 0 THEN 10 ELSE at.atr_descuento_paquete END
          FROM (SELECT COALESCE(bool_or(c.cat_slug IN ('tours-ciudad', 'trenes-miradores', 'gastronomia', 'cultural'))
                                AND NOT bool_or(c.cat_slug IN ('montana', 'aventura', 'playas', 'vida-silvestre')), FALSE) AS urbano
                  FROM atraccion_categoria ac JOIN categoria c ON c.cat_id = ac.cat_id WHERE ac.atr_id = a.atr_id) x
         WHERE at.atr_id = a.atr_id;

        -- Itinerario de ejemplo a partir de la primera salida y la duración
        SELECT COALESCE(MIN(h.hor_hora), TIME '08:00') INTO v_hora FROM horario h WHERE h.atr_id = a.atr_id AND h.hor_activo;
        SELECT atr_incluye_comida INTO v_comida FROM atraccion WHERE atr_id = a.atr_id;
        v_total := LEAST(GREATEST(round(a.atr_duracion_horas * 60)::int, 60), 720);
        v_principal := v_total - 15 - 15 - CASE WHEN v_comida THEN 45 ELSE 0 END;
        IF v_principal < 15 THEN v_principal := 15; END IF;

        INSERT INTO atraccion_itinerario (atr_id, iti_orden, iti_hora, iti_titulo, iti_descripcion, iti_duracion_min, iti_lugar) VALUES
            (a.atr_id, 1, v_hora, 'Encuentro y bienvenida',
             'Recepción de pasajeros, verificación del voucher QR y charla de seguridad con el guía.', 15, left(a.punto, 150)),
            (a.atr_id, 2, v_hora + interval '15 minutes', left(a.atr_nombre, 150),
             'Recorrido principal de la experiencia con explicaciones del guía.', v_principal, left(a.ciudad, 150));
        IF v_comida THEN
            INSERT INTO atraccion_itinerario (atr_id, iti_orden, iti_hora, iti_titulo, iti_descripcion, iti_duracion_min, iti_lugar)
            VALUES (a.atr_id, 3, v_hora + make_interval(mins => 15 + v_principal), 'Comida incluida',
                    'Pausa para el almuerzo o refrigerio incluido en la experiencia.', 45, left(a.ciudad, 150));
        END IF;
        INSERT INTO atraccion_itinerario (atr_id, iti_orden, iti_hora, iti_titulo, iti_descripcion, iti_duracion_min, iti_lugar)
        VALUES (a.atr_id, CASE WHEN v_comida THEN 4 ELSE 3 END,
                v_hora + make_interval(mins => 15 + v_principal + CASE WHEN v_comida THEN 45 ELSE 0 END),
                'Cierre y retorno', 'Despedida y regreso al punto de encuentro.', 15, left(a.punto, 150));
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

COMMENT ON FUNCTION atraccion_completar_v2() IS 'Completa los datos del contrato v2 en las atracciones que aún no los tienen (demostración, idempotente)';

SELECT atraccion_completar_v2();

-- Misma política que el resto del modelo (ver 002_seguridad.sql)
ALTER TABLE atraccion_itinerario       ENABLE ROW LEVEL SECURITY;
ALTER TABLE acuerdo_promocion          ENABLE ROW LEVEL SECURITY;
ALTER TABLE acuerdo_promocion_destino  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.sync_stock             ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.atraccion_itinerario, public.acuerdo_promocion, public.acuerdo_promocion_destino FROM %I', rol);
            EXECUTE format('REVOKE ALL ON TABLE ops.sync_stock FROM %I', rol);
            EXECUTE format('REVOKE ALL ON FUNCTION public.atraccion_completar_v2() FROM %I', rol);
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION atraccion_completar_v2() FROM PUBLIC;

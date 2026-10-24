-- ============================================================================
--  DESCUBRE EC  ·  BOLETO DE ESTUDIANTE (contrato v2 final con Booking)
-- ============================================================================
--  La versión final de contracts/atracciones-openapi-v2.yaml agrega un quinto
--  tipo de boleto: estudiante con carnet vigente (`student_count`, tarifa
--  `student`, «descuento típico 25 %»). Se agrega igual que el de adulto mayor:
--   · tarifa ESTUDIANTE (versionada, como las demás);
--   · cantidad y precio congelado en la reserva;
--   · tipo de boleto STUDENT en los acompañantes;
--   · línea propia en el detalle de la factura;
--   · datos de demostración: 75 % del precio de adulto.
--  Copia de documentación: database/10_boleto_estudiante.sql
-- ============================================================================

ALTER TABLE tarifa DROP CONSTRAINT tarifa_tipo_valido;
ALTER TABLE tarifa ADD CONSTRAINT tarifa_tipo_valido
    CHECK (tar_tipo IN ('ADULTO', 'NINO', 'MAYOR', 'ESTUDIANTE', 'GRUPO'));

ALTER TABLE reserva DROP CONSTRAINT reserva_pasajeros_validos;
ALTER TABLE reserva DROP CONSTRAINT reserva_total_coherente;
ALTER TABLE reserva
    ADD COLUMN res_estudiantes       INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN res_precio_estudiante dom_importe,
    ADD CONSTRAINT reserva_pasajeros_validos
        CHECK (res_adultos > 0 AND res_ninos >= 0 AND res_seniors >= 0 AND res_infantes >= 0 AND res_estudiantes >= 0),
    ADD CONSTRAINT reserva_total_coherente
        CHECK (res_numero_tickets = res_adultos + res_ninos + res_seniors + res_infantes + res_estudiantes);

ALTER TABLE reserva_pasajero DROP CONSTRAINT reserva_pasajero_tipo_boleto_valido;
ALTER TABLE reserva_pasajero ALTER COLUMN pax_tipo_boleto TYPE VARCHAR(7);   -- 'STUDENT' tiene 7 letras
ALTER TABLE reserva_pasajero ADD CONSTRAINT reserva_pasajero_tipo_boleto_valido
    CHECK (pax_tipo_boleto IS NULL OR pax_tipo_boleto IN ('ADULT', 'CHILD', 'SENIOR', 'STUDENT', 'INFANT'));

-- ── Detalle de factura con los 5 tipos de boleto ──────────────────────────
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
               re.res_adultos, re.res_ninos, re.res_seniors, re.res_infantes, re.res_estudiantes, re.res_precio_unitario,
               re.res_precio_nino, re.res_precio_senior, re.res_precio_estudiante, re.res_subtotal,
               CASE WHEN re.res_precio_nino IS NOT NULL OR re.res_seniors > 0 OR re.res_estudiantes > 0
                         THEN round(re.res_adultos * re.res_precio_unitario, 2)
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
                    ELSE res_subtotal - base_adultos - round(res_seniors * COALESCE(res_precio_senior, 0), 2)
                         - round(res_estudiantes * COALESCE(res_precio_estudiante, 0), 2) END
          FROM r WHERE res_ninos > 0
        UNION ALL
        SELECT fac_id, tarifa, det_id, 3, 'ATR-' || atr_id || '-SE', det_descripcion || ' · Adulto mayor', res_seniors,
               res_precio_senior, round(res_seniors * res_precio_senior, 2)
          FROM r WHERE res_seniors > 0
        UNION ALL
        SELECT fac_id, tarifa, det_id, 4, 'ATR-' || atr_id || '-ES', det_descripcion || ' · Estudiante', res_estudiantes,
               res_precio_estudiante, round(res_estudiantes * res_precio_estudiante, 2)
          FROM r WHERE res_estudiantes > 0
        UNION ALL
        SELECT fac_id, tarifa, det_id, 5, 'ATR-' || atr_id || '-IN', det_descripcion || ' · Infante', res_infantes, 0, 0
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

-- ── Tarifa de estudiante para la demostración ──────────────────────────────
--  75 % del adulto vigente en las atracciones que aún no la tienen. Idempotente; el seed la usa
--  en una base nueva, después de atraccion_completar_v2().
CREATE FUNCTION tarifa_estudiante_demo() RETURNS INTEGER
LANGUAGE sql AS $$
    WITH ins AS (
        INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde)
        SELECT DISTINCT ON (t.atr_id) t.atr_id, 'ESTUDIANTE', round(t.tar_precio * 0.75, 2), t.tar_moneda, t.tar_vigente_desde
          FROM tarifa t
         WHERE t.tar_tipo = 'ADULTO' AND t.tar_vigente_hasta IS NULL
           AND NOT EXISTS (SELECT 1 FROM tarifa e WHERE e.atr_id = t.atr_id AND e.tar_tipo = 'ESTUDIANTE')
         ORDER BY t.atr_id, t.tar_vigente_desde DESC
        RETURNING 1
    )
    SELECT COUNT(*)::int FROM ins;
$$;

SELECT tarifa_estudiante_demo();

DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION public.tarifa_estudiante_demo() FROM %I', rol);
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION tarifa_estudiante_demo() FROM PUBLIC;

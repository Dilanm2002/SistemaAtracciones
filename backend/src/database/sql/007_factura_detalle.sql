-- ============================================================================
--  DESCUBRE EC  ·  DETALLE DE LA FACTURA (encabezado + detalle del SRI)
-- ============================================================================
--  `factura` era solo el encabezado: sus líneas se leían de `orden_detalle`.
--  Pero la orden es el documento COMERCIAL (lo que se compró, puede cambiar o
--  cancelarse) y la factura es el documento TRIBUTARIO (lo que se declara al
--  SRI, no se modifica nunca: se anula). Por eso la factura necesita sus
--  propias líneas, congeladas al emitirla:
--
--     orden ── orden_detalle ── reserva        (comercial)
--       │            ┆ det_id (solo referencia)
--     factura ── factura_detalle               (tributario)
--
--  Cada reserva se factura en una línea por tipo de pasajero (adulto / niño),
--  con su base imponible, tarifa e importe de IVA, como pide el comprobante
--  electrónico. La suma de las líneas cuadra con el encabezado (V-16).
--  Copia de documentación: database/07_factura_detalle.sql
-- ============================================================================

CREATE TABLE factura_detalle (
    fde_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fac_id               BIGINT       NOT NULL,
    fde_linea            SMALLINT     NOT NULL,      -- orden de la línea dentro de la factura (1, 2, …)
    det_id               BIGINT,                     -- línea de orden de origen (referencia)
    fde_codigo           VARCHAR(25)  NOT NULL,      -- código principal del producto
    fde_descripcion      VARCHAR(255) NOT NULL,      -- snapshot: «Tour Quilotoa · 2026-10-20 09:00 · Adulto»
    fde_cantidad         INTEGER      NOT NULL,
    fde_precio_unitario  dom_importe  NOT NULL,
    fde_descuento        dom_importe  NOT NULL DEFAULT 0,
    fde_base_imponible   dom_importe  NOT NULL,      -- precio × cantidad − descuento
    fde_tarifa_iva       NUMERIC(5,2) NOT NULL DEFAULT 0,   -- porcentaje: 0.00, 15.00…
    fde_valor_iva        dom_importe  NOT NULL DEFAULT 0,
    fde_total            dom_importe  NOT NULL,      -- base imponible + IVA
    CONSTRAINT uq_factura_detalle_linea UNIQUE (fac_id, fde_linea),
    CONSTRAINT factura_detalle_cantidad_valida CHECK (fde_cantidad > 0),
    CONSTRAINT factura_detalle_linea_valida CHECK (fde_linea > 0),
    CONSTRAINT factura_detalle_tarifa_valida CHECK (fde_tarifa_iva BETWEEN 0 AND 100),
    CONSTRAINT factura_detalle_total_coherente CHECK (fde_total = fde_base_imponible + fde_valor_iva),
    CONSTRAINT fk_factura_detalle_factura
        FOREIGN KEY (fac_id) REFERENCES factura (fac_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_factura_detalle_orden_detalle
        FOREIGN KEY (det_id) REFERENCES orden_detalle (det_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_factura_detalle_fac_id ON factura_detalle (fac_id);
CREATE INDEX ix_factura_detalle_det_id ON factura_detalle (det_id);

COMMENT ON TABLE factura_detalle IS 'Líneas de la factura (documento tributario), congeladas al emitir; independientes de orden_detalle';

-- ── Genera las líneas de una factura a partir de su orden ──────────────────
--  Idempotente: si la factura ya tiene líneas, no hace nada. La usan el backend
--  al emitir (compras.ts · emitirFactura) y el relleno de las facturas previas.
CREATE FUNCTION factura_generar_detalle(p_fac_id BIGINT) RETURNS INTEGER
LANGUAGE sql AS $$
    WITH f AS (
        SELECT fa.fac_id, o.ord_id,
               CASE WHEN o.ord_subtotal > 0 THEN round(o.ord_iva * 100 / o.ord_subtotal, 2) ELSE 0 END AS tarifa
          FROM factura fa JOIN orden o ON o.ord_id = fa.ord_id
         WHERE fa.fac_id = p_fac_id
           AND NOT EXISTS (SELECT 1 FROM factura_detalle x WHERE x.fac_id = fa.fac_id)
    ),
    -- Por cada línea de orden: el importe de adultos y el de niños de su reserva
    r AS (
        SELECT f.fac_id, f.tarifa, dt.det_id, dt.det_descripcion, a.atr_id, dt.det_cantidad, dt.det_precio_unitario,
               dt.det_subtotal, re.res_adultos, re.res_ninos, re.res_precio_unitario, re.res_subtotal,
               CASE WHEN re.res_ninos = 0 THEN re.res_subtotal
                    ELSE LEAST(round(re.res_adultos * re.res_precio_unitario, 2), re.res_subtotal) END AS base_adultos
          FROM f
          JOIN orden_detalle dt ON dt.ord_id = f.ord_id
          JOIN atraccion a      ON a.atr_id = dt.atr_id
          LEFT JOIN reserva re  ON re.det_id = dt.det_id
    ),
    lineas AS (
        -- Adultos (o la línea completa si la orden no tiene reserva)
        SELECT fac_id, tarifa, det_id, 1 AS tipo,
               'ATR-' || atr_id || CASE WHEN res_adultos IS NULL THEN '' ELSE '-AD' END AS codigo,
               det_descripcion || CASE WHEN res_adultos IS NULL THEN '' ELSE ' · Adulto' END AS descripcion,
               COALESCE(res_adultos, det_cantidad) AS cantidad,
               COALESCE(res_precio_unitario, det_precio_unitario) AS precio,
               COALESCE(base_adultos, det_subtotal) AS base
          FROM r
        UNION ALL
        -- Niños: el resto del subtotal de la reserva
        SELECT fac_id, tarifa, det_id, 2,
               'ATR-' || atr_id || '-NI',
               det_descripcion || ' · Niño',
               res_ninos,
               round((res_subtotal - base_adultos) / res_ninos, 2),
               res_subtotal - base_adultos
          FROM r
         WHERE res_ninos > 0
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

COMMENT ON FUNCTION factura_generar_detalle(BIGINT) IS 'Crea las líneas de factura_detalle desde la orden de la factura (idempotente)';

-- ── Relleno: las facturas ya emitidas reciben sus líneas ───────────────────
SELECT factura_generar_detalle(fac_id) FROM factura ORDER BY fac_id;

-- Misma política que el resto del modelo (ver 002_seguridad.sql)
ALTER TABLE factura_detalle ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rol TEXT;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.factura_detalle FROM %I', rol);
            EXECUTE format('REVOKE ALL ON FUNCTION public.factura_generar_detalle(BIGINT) FROM %I', rol);
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION factura_generar_detalle(BIGINT) FROM PUBLIC;

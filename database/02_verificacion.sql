-- ============================================================================
--  DESCUBRE EC  ·  SCRIPT DE VERIFICACION DEL MODELO RELACIONAL
--  Uso:  psql -U postgres -d descubre_ec -f 02_verificacion.sql
-- ============================================================================
--
--  Cada bloque responde una pregunta concreta sobre el modelo.
--  REGLA DE ORO: una verificacion PASA cuando devuelve 0 filas.
--  Si alguna devuelve filas, hay que corregirla.
-- ============================================================================


-- ============================================================================
--  V-01 · ESTRUCTURA: tabla que existe sin clave primaria
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Toda tabla debe tener PK.
-- ============================================================================
-- PASS: 0 filas. Toda tabla debe tener clave primaria.
SELECT 'V-01 · Tabla sin clave primaria' AS verificacion,
       c.relname AS tabla
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = c.oid AND k.contype = 'p')
ORDER BY 2;


-- ============================================================================
--  V-02 · CONVENCION: PK que no sigue el patron <sigla>_id
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Toda PK de una sola columna debe terminar en _id.
-- ============================================================================
SELECT 'V-02 · PK sin sufijo _id' AS verificacion,
       c.relname  AS tabla,
       a.attname  AS columna_pk
FROM pg_class c
JOIN pg_namespace n  ON n.oid = c.relnamespace
JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey)
WHERE n.nspname = 'public'
  AND array_length(k.conkey, 1) = 1      -- solo PK simples
  AND a.attname NOT LIKE '%\_id'
ORDER BY 2, 3;


-- ============================================================================
--  V-03 · INTEGRIDAD: FK declarada contra una columna que no existe
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Toda FK debe apuntar a una PK real de la tabla padre.
-- ============================================================================
SELECT 'V-03 · FK huerfana' AS verificacion,
       child.relname AS tabla_hija,
       cn.conname    AS fk,
       att2.attname  AS columna_hija,
       parent.relname AS tabla_padre,
       att.attname   AS columna_padre
FROM pg_constraint cn
JOIN pg_class child        ON child.oid = cn.conrelid
JOIN pg_namespace n         ON n.oid = child.relnamespace
JOIN pg_class parent        ON parent.oid = cn.confrelid
JOIN unnest(cn.conkey)  AS k1(attnum) ON TRUE
JOIN unnest(cn.confkey) AS k2(attnum) ON TRUE
JOIN pg_attribute att  ON att.attrelid  = child.oid  AND att.attnum  = k1.attnum
JOIN pg_attribute att2 ON att2.attrelid = parent.oid AND att2.attnum = k2.attnum
WHERE cn.contype = 'f'
  AND n.nspname = 'public'
  AND NOT EXISTS (      -- la columna padre debe ser PK o UNIQUE
        SELECT 1 FROM pg_constraint u
        WHERE u.conrelid = cn.confrelid
          AND u.contype IN ('p','u')
          AND k2.attnum = ANY (u.conkey))
ORDER BY 3;


-- ============================================================================
--  V-04 · RENDIMIENTO: FK sin indice
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Sin indice, cada JOIN y cada DELETE en cascada
--  recorren la tabla hija completa.
-- ============================================================================
SELECT 'V-04 · FK sin indice' AS verificacion,
       child.relname AS tabla,
       a.attname     AS columna_fk
FROM pg_constraint cn
JOIN pg_class child        ON child.oid = cn.conrelid
JOIN pg_namespace n         ON n.oid = child.relnamespace
JOIN pg_class parent        ON parent.oid = cn.confrelid
JOIN unnest(cn.conkey) AS k(attnum) ON TRUE
JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = k.attnum
WHERE cn.contype = 'f'
  AND n.nspname = 'public'
  AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = cn.conrelid
          AND a.attnum = ANY (i.indkey))
ORDER BY 2, 3;


-- ============================================================================
--  V-05 · NORMALIZACION: texto que deberia ser clave foranea
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Si una columna guarda el NOMBRE de una provincia,
--  ciudad o rol, hay denormalizacion: debe ser FK.
-- ============================================================================
-- PASS: 0 filas. Si una tabla AJENA al catalogo guarda el NOMBRE de una
-- provincia, ciudad o rol, hay denormalizacion: debe ser FK.
-- (En provincia/ciudad/region/rol el nombre SI es su propio atributo.)
SELECT 'V-05 · Columna *_nombre que deberia ser FK' AS verificacion,
       c.table_name, c.column_name
FROM information_schema.columns c
JOIN information_schema.tables t
     ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND c.column_name IN ('prov_nombre','ciu_nombre','reg_nombre',
                        'rol_nombre','cat_nombre')
  AND c.table_name NOT IN ('provincia','ciudad','region','rol','categoria')
ORDER BY 2, 3;


-- ============================================================================
--  V-06 · NORMALIZACION: columna duplicada dentro de la misma tabla
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Detecta el patron "copiar el dato del padre aqui".
-- ============================================================================
SELECT 'V-06 · Columna heredada sin normalizar' AS verificacion,
       c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name IN ('nombre','correo','telefono','documento','activo')
  AND c.table_name NOT IN ('usuario','provincia','ciudad','region','rol',
                           'categoria','atraccion','operador','idioma',
                           'inclusion','metodo_pago','estado','cupon',
                           'mensaje_contacto')
ORDER BY 2, 3;


-- ============================================================================
--  V-07 · DOMINIO: importes que NO usan dom_importe
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Todo importe debe ser NUMERIC y no float.
--  Se buscan prefijos de importe completos (evita falsos positivos como
--  "cat_activa", que contiene la cadena "iva" pero no es un importe).
-- ============================================================================
SELECT 'V-07 · Importe sin dominio numeric' AS verificacion,
       c.table_name, c.column_name, c.data_type
FROM information_schema.columns c
JOIN information_schema.tables t
     ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND (c.column_name ~ '(^|_)(precio|monto|subtotal|iva|descuento)(_|$)'
    OR c.column_name LIKE 'det\_precio%'
    OR c.column_name LIKE 'res\_precio%'
    OR c.column_name = 'pag_monto'
    OR (c.column_name ~ '(^|_)(total|valor)(_|$)'
        AND c.data_type NOT IN ('integer','bigint','smallint','boolean')))
  AND c.data_type NOT IN ('numeric', 'USER-DEFINED')
ORDER BY 2, 3;


-- ============================================================================
--  V-08 · CUMPLIMIENTO: FK que usa el comportamiento por defecto
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Toda FK debe decir que pasa al borrar el padre
--  (CASCADE, RESTRICT, SET NULL). Si no lo dice, PostgreSQL usa NO ACTION.
-- ============================================================================
SELECT 'V-08 · FK sin ON DELETE explicito' AS verificacion,
       child.relname AS tabla_hija, cn.conname AS fk
FROM pg_constraint cn
JOIN pg_class child   ON child.oid = cn.conrelid
JOIN pg_namespace n    ON n.oid = child.relnamespace
WHERE cn.contype = 'f'
  AND n.nspname = 'public'
  AND cn.confdeltype = 'a'          -- 'a' = NO ACTION (por defecto)
ORDER BY 2, 3;


-- ============================================================================
--  V-09 · INTEGRIDAD: datos huerfanos reales
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Comprueba que ninguna FK apunte a la nada.
--  (Requiere que existan filas; se ejecuta con datos de prueba cargados.)
-- ============================================================================
SELECT 'V-09a · Atraccion sin provincia valida' AS verificacion, COUNT(*) AS huerfanos
FROM atraccion a
LEFT JOIN provincia p ON p.prov_id = a.prov_id
WHERE p.prov_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09b · Atraccion sin ciudad valida', COUNT(*)
FROM atraccion a
LEFT JOIN ciudad c ON c.ciu_id = a.ciu_id
WHERE c.ciu_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09c · Ciudad en provincia equivocada', COUNT(*)
FROM atraccion a
JOIN ciudad c    ON c.ciu_id = a.ciu_id
JOIN provincia p ON p.prov_id = a.prov_id
WHERE c.prov_id <> a.prov_id
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09c2 · Direccion con ciudad de otra provincia', COUNT(*)
FROM direccion d
JOIN ciudad c    ON c.ciu_id = d.ciu_id
JOIN provincia p ON p.prov_id = d.prov_id
WHERE c.prov_id <> d.prov_id
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09d · Orden sin usuario valido', COUNT(*)
FROM orden o
LEFT JOIN usuario u ON u.usu_id = o.usu_id
WHERE u.usu_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09e · Pago sin orden valida', COUNT(*)
FROM pago pg
LEFT JOIN orden o ON o.ord_id = pg.ord_id
WHERE o.ord_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09f · Reserva con total de tickets incoherente', COUNT(*)
FROM reserva
WHERE res_numero_tickets <> res_adultos + res_ninos
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09g · Disponibilidad con cupo sobreexplotado', COUNT(*)
FROM disponibilidad
WHERE dis_cupo_reservado > dis_cupo_total
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09h · Usuario sin ningun rol asignado', COUNT(*)
FROM usuario u
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.usu_id = u.usu_id)
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09i · Resena sin atraccion valida', COUNT(*)
FROM resena r
LEFT JOIN atraccion a ON a.atr_id = r.atr_id
WHERE a.atr_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09j · Carrito_item sin carrito valido', COUNT(*)
FROM carrito_item ci
LEFT JOIN carrito c ON c.car_id = ci.car_id
WHERE c.car_id IS NULL
HAVING COUNT(*) > 0
UNION ALL
SELECT 'V-09k · Reembolso sobre pago no aprobado', COUNT(*)
FROM reembolso rem
JOIN pago p ON p.pag_id = rem.pag_id
LEFT JOIN estado e ON e.est_id = p.est_id
WHERE rem.rem_procesado_en IS NOT NULL
  AND (e.est_codigo IS DISTINCT FROM 'APROBADO'
       AND e.est_codigo IS DISTINCT FROM 'REEMBOLSADO')
HAVING COUNT(*) > 0
ORDER BY 2 DESC;


-- ============================================================================
--  V-10 · NEGOCIO: orden cuyo total no cuadra con sus lineas
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. El total guardado debe coincidir con el calculo.
-- ============================================================================
SELECT 'V-10 · Total de orden incoherente' AS verificacion,
       o.ord_id, o.ord_numero, o.ord_total,
       (o.ord_subtotal - o.ord_descuento + o.ord_iva) AS total_esperado
FROM orden o
WHERE o.ord_total <> (o.ord_subtotal - o.ord_descuento + o.ord_iva)
   OR o.ord_subtotal <> COALESCE(
        (SELECT SUM(d.det_subtotal) FROM orden_detalle d
         WHERE d.ord_id = o.ord_id), 0)
ORDER BY 2;


-- ============================================================================
--  V-11 · SEGURIDAD: datos que NUNCA deben duplicarse
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. La PII del pasajero vive en reserva_pasajero,
--  no copiada en la reserva.
-- ============================================================================
SELECT 'V-11 · PII duplicada' AS verificacion, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'reserva'
  AND column_name IN ('res_cliente_nombre','res_cliente_correo',
                      'res_cliente_telefono','res_cliente_documento')
ORDER BY 2;


-- ============================================================================
--  V-12 · INVENTARIO: resumen de la estructura creada
--  ---------------------------------------------------------------------------
-- ============================================================================
--  V-14 · PRUEBA FUNCIONAL: las reglas de negocio en accion
--  ---------------------------------------------------------------------------
--  Las consultas V-01..V-13 miran el CATALOGO. Estas comprueban que las
--  restricciones realmente rechacen datos malos. Se ejecuta dentro de una
--  transaccion que se revierte al final, asi la base queda intacta.
--
--  Cada caso debe mostrar su mensaje "OK". Si sale "FALLO", la restriccion
--  que deberia impedirlo no esta funcionando.
-- ============================================================================
BEGIN;

DO $$
DECLARE
    v_usu  BIGINT;
    v_ope  BIGINT;
    v_atr  BIGINT;
    v_hor  BIGINT;
    v_dis  BIGINT;
    v_prov SMALLINT;
    v_ciu_cuenca SMALLINT;      -- ciudad en Azuay
    v_ciu_quito  SMALLINT;      -- ciudad en Pichincha
    v_ord  BIGINT;
    v_pag  BIGINT;
    v_det  BIGINT;
    v_ca   BIGINT;
    v_rol  SMALLINT;
    v_est_aprobado     SMALLINT;
    v_est_orden_creada SMALLINT;
BEGIN
    SELECT prov_id INTO v_prov FROM provincia WHERE prov_nombre = 'Azuay';
    SELECT ciu_id  INTO v_ciu_cuenca FROM ciudad WHERE ciu_codigo = '010100';
    SELECT ciu_id  INTO v_ciu_quito  FROM ciudad WHERE ciu_codigo = '170150';
    SELECT est_id  INTO v_est_aprobado     FROM estado WHERE est_codigo = 'APROBADO';
    SELECT est_id  INTO v_est_orden_creada FROM estado WHERE est_codigo = 'CREADA';

    INSERT INTO usuario (usu_correo, usu_password, usu_documento, usu_nombre, usu_apellido)
    VALUES ('prueba@descubre.ec', 'hash-de-prueba', '1712345678', 'Prueba', 'Validacion')
    RETURNING usu_id INTO v_usu;

    SELECT rol_id INTO v_rol FROM rol LIMIT 1;
    INSERT INTO usuario_rol (usu_id, rol_id) VALUES (v_usu, v_rol);

    INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, prov_id)
    VALUES (999, 'Operador Prueba', '1799999999001', v_prov)
    RETURNING ope_id INTO v_ope;

    INSERT INTO atraccion (atr_nombre, atr_descripcion, atr_slug, atr_tipo,
                          atr_latitud, atr_longitud, atr_duracion_horas,
                          prov_id, ciu_id, ope_id)
    VALUES ('Tour Prueba', 'Tour de prueba para validar el esquema',
            'tour-prueba-validacion', 'DAY_TRIP',
            -2.9000, -79.5000, 8, v_prov, v_ciu_cuenca, v_ope)
    RETURNING atr_id INTO v_atr;

    INSERT INTO horario (atr_id, hor_hora, hor_cupo)
    VALUES (v_atr, '08:00', 20) RETURNING hor_id INTO v_hor;

    INSERT INTO tarifa (atr_id, tar_tipo, tar_precio)
    VALUES (v_atr, 'ADULTO', 50.00);

    INSERT INTO disponibilidad (atr_id, hor_id, dis_fecha, dis_cupo_total)
    VALUES (v_atr, v_hor, CURRENT_DATE + 30, 20)
    RETURNING dis_id INTO v_dis;

    RAISE NOTICE 'Datos de prueba creados: usuario=%, atraccion=%', v_usu, v_atr;

    -- CASO 1 (debe FALLAR): ciudad de OTRA provincia que la declarada.
    BEGIN
        INSERT INTO atraccion (atr_nombre, atr_descripcion, atr_slug, atr_tipo,
                              atr_latitud, atr_longitud, atr_duracion_horas,
                              prov_id, ciu_id, ope_id)
        VALUES ('Tour Incoherente', 'Debe fallar por ciudad de otra provincia',
                'tour-incoherente-validacion', 'DAY_TRIP',
                -0.1807, -78.4678, 5, v_prov, v_ciu_quito, v_ope);
        RAISE EXCEPTION 'FALLO: permitio atraccion con ciudad de otra provincia';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'CASO 1  OK: FK compuesta rechazo ciudad de otra provincia';
    END;

    -- CASO 2 (debe FALLAR): correo duplicado.
    BEGIN
        INSERT INTO usuario (usu_correo, usu_password, usu_documento,
                             usu_nombre, usu_apellido)
        VALUES ('prueba@descubre.ec', 'otra', '0900000000', 'Otro', 'Usuario');
        RAISE EXCEPTION 'FALLO: permitio correo duplicado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'CASO 2  OK: correo duplicado rechazado';
    END;

    -- CASO 3 (debe FALLAR): provincia con region que no existe.
    BEGIN
        INSERT INTO provincia (prov_nombre, prov_codigo, reg_id)
        VALUES ('Provincia Fantasma', '99', 999);
        RAISE EXCEPTION 'FALLO: permitio provincia con region inexistente';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'CASO 3  OK: FK provincia.reg_id rechazo region inexistente';
    END;

    -- CASO 4 (debe FALLAR): orden_cupon con orden y cupon inexistentes.
    BEGIN
        INSERT INTO orden_cupon (ord_id, cup_id) VALUES (-1, -1);
        RAISE EXCEPTION 'FALLO: permitio orden_cupon huerfano';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'CASO 4  OK: FK de orden_cupon rechazo referencias inexistentes';
    END;

    -- Flujo comercial valido: orden -> detalle -> pago
    INSERT INTO orden (ord_numero, usu_id, est_id, ord_subtotal, ord_total)
    VALUES ('ORD-PRUEBA-01', v_usu, v_est_orden_creada, 100.00, 100.00)
    RETURNING ord_id INTO v_ord;

    INSERT INTO orden_detalle (ord_id, atr_id, det_descripcion, det_cantidad,
                               det_precio_unitario, det_subtotal)
    VALUES (v_ord, v_atr, 'Tour Prueba', 2, 50.00, 100.00)
    RETURNING det_id INTO v_det;

    INSERT INTO pago (pag_numero, ord_id, mpa_id, est_id, pag_monto)
    SELECT 'PAG-PRUEBA-01', v_ord, mpa_id, v_est_aprobado, 100.00
    FROM metodo_pago WHERE mpa_codigo = 'TARJETA'
    RETURNING pag_id INTO v_pag;

    -- CASO 5 (debe FALLAR): reembolso mayor a lo cobrado.
    BEGIN
        INSERT INTO reembolso (pag_id, rem_numero, rem_monto, rem_procesado_en)
        VALUES (v_pag, 'REM-PRUEBA-01', 150.00, now());
        RAISE EXCEPTION 'FALLO: permitio reembolsar mas de lo cobrado';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'Reembolso mayor al pago%' THEN
            RAISE NOTICE 'CASO 5  OK: trigger impidio reembolso 150 > pago 100';
        ELSE
            RAISE EXCEPTION 'FALLO inesperado en CASO 5: %', SQLERRM;
        END IF;
    END;

    -- CASO 6 (debe PASAR): reembolso por el importe exacto.
    INSERT INTO reembolso (pag_id, rem_numero, rem_monto, rem_procesado_en)
    VALUES (v_pag, 'REM-PRUEBA-02', 100.00, now());
    RAISE NOTICE 'CASO 6  OK: reembolso por el importe exacto permitido';

    -- CASO 7 (debe FALLAR): dos carritos activos para el mismo usuario.
    INSERT INTO carrito (usu_id) VALUES (v_usu);
    BEGIN
        INSERT INTO carrito (usu_id) VALUES (v_usu);
        RAISE EXCEPTION 'FALLO: permitio segundo carrito activo';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'CASO 7  OK: indice parcial impidio segundo carrito activo';
    END;

    -- CASO 8 (debe PASAR): carrito inactivo adicional.
    INSERT INTO carrito (usu_id, car_activo) VALUES (v_usu, FALSE);
    RAISE NOTICE 'CASO 8  OK: carrito inactivo adicional permitido';

    -- CASO 9 (debe FALLAR): dos direcciones principales.
    INSERT INTO direccion (usu_id, prov_id, ciu_id, dir_linea1, dir_es_principal)
    VALUES (v_usu, v_prov, v_ciu_cuenca, 'Calle 1', TRUE);
    BEGIN
        INSERT INTO direccion (usu_id, prov_id, ciu_id, dir_linea1, dir_es_principal)
        VALUES (v_usu, v_prov, v_ciu_cuenca, 'Calle 2', TRUE);
        RAISE EXCEPTION 'FALLO: permitio segunda direccion principal';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'CASO 9  OK: indice parcial impidio segunda direccion principal';
    END;

    -- CASO 10 (debe PASAR): varias direcciones NO principales.
    INSERT INTO direccion (usu_id, prov_id, ciu_id, dir_linea1, dir_es_principal)
    VALUES (v_usu, v_prov, v_ciu_cuenca, 'Calle 3', FALSE);
    INSERT INTO direccion (usu_id, prov_id, ciu_id, dir_linea1, dir_es_principal)
    VALUES (v_usu, v_prov, v_ciu_cuenca, 'Calle 4', FALSE);
    RAISE NOTICE 'CASO 10 OK: varias direcciones no principales permitidas';

    -- CASO 11 (debe FALLAR): favorito duplicado.
    INSERT INTO favorito (usu_id, atr_id) VALUES (v_usu, v_atr);
    BEGIN
        INSERT INTO favorito (usu_id, atr_id) VALUES (v_usu, v_atr);
        RAISE EXCEPTION 'FALLO: permitio favorito duplicado';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'CASO 11 OK: favorito duplicado rechazado';
    END;

    RAISE NOTICE '--- CASOS FUNCIONALES COMPLETADOS ---';
END $$;

ROLLBACK;   -- nada de lo anterior queda guardado


-- ============================================================================
--  V-15 · CATALOGO GEOGRAFICO: datos base correctos
--  ---------------------------------------------------------------------------
--  PASS: 0 filas. Ecuador tiene 24 provincias, 4 regiones y ningun
--  nombre con '?' (senal de que se perdio la codificacion UTF-8).
-- ============================================================================
SELECT 'V-15 · Provincias: se esperaban 24 y hay ' || COUNT(*)::text AS verificacion
FROM provincia HAVING COUNT(*) <> 24
UNION ALL
SELECT 'V-15 · Region: se esperaban 4 y hay ' || COUNT(*)::text FROM region HAVING COUNT(*) <> 4
UNION ALL
SELECT 'V-15 · Nombre con interrogacion (encoding roto): ' || prov_nombre FROM provincia WHERE prov_nombre ~ '\?'
UNION ALL
SELECT 'V-15 · Ciudad sin provincia asignada: ' || c.ciu_nombre
FROM ciudad c LEFT JOIN provincia p ON p.prov_id = c.prov_id WHERE p.prov_id IS NULL
UNION ALL
SELECT 'V-15 · Rol base faltante: ' || r
FROM unnest(ARRAY['ADMIN','OPERADOR','CLIENTE']) AS r
WHERE NOT EXISTS (SELECT 1 FROM rol WHERE rol_nombre = r)
UNION ALL
SELECT 'V-15 · Estado base faltante: ' || e
FROM unnest(ARRAY['CREADA','PAGADA','APROBADO','RECHAZADO','CONFIRMADA']) AS e
WHERE NOT EXISTS (SELECT 1 FROM estado WHERE est_codigo = e)
UNION ALL
SELECT 'V-15 · Metodo de pago sin registrar: ' || m
FROM unnest(ARRAY['TARJETA','TRANSFERENCIA','EN_SITIO']) AS m
WHERE NOT EXISTS (SELECT 1 FROM metodo_pago WHERE mpa_codigo = m);


SELECT 'V-12 - Resumen' AS verificacion,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE') AS tablas,
       (SELECT COUNT(*) FROM information_schema.views
        WHERE table_schema='public') AS vistas,
       (SELECT COUNT(*) FROM pg_constraint
        WHERE contype='p' AND connamespace='public'::regnamespace) AS claves_primarias,
       (SELECT COUNT(*) FROM pg_constraint
        WHERE contype='f' AND connamespace='public'::regnamespace) AS claves_foraneas,
       (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public') AS indices;


-- ============================================================================
--  V-13 · TRAZABILIDAD: mapa completo tabla -> PK -> FK
--  ---------------------------------------------------------------------------
--  Sirve para revisar el modelo de un vistazo.
-- ============================================================================
SELECT
    c.relname                                        AS tabla,
    (SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum =
        (SELECT k.conkey[1] FROM pg_constraint k
         WHERE k.conrelid = c.oid AND k.contype='p'))   AS clave_primaria,
    COALESCE((SELECT string_agg(
        ccu.table_name || '.' || ccu.column_name, ', ')
      FROM information_schema.key_column_usage ccu
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY'
        AND ccu.table_name = c.relname), '-')             AS claves_foraneas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;

-- ============================================================================
--  DESCUBRE EC  ·  CÉDULA Y TELÉFONO ECUATORIANOS
-- ============================================================================
--  El modelo original aceptaba pasaportes en dom_documento y cualquier número
--  internacional (7-15 dígitos) en dom_telefono. Regla nueva del negocio:
--    · dom_documento: cédula ecuatoriana válida (10 dígitos, provincia 01-24 o
--      30, tercer dígito 0-5 y dígito verificador módulo 10).
--    · dom_telefono: número ecuatoriano en formato nacional:
--        celular  09XXXXXXXX  (10 dígitos)
--        fijo     0[2-7]XXXXXXX (9 dígitos: 0 + código de provincia + 7)
--  Las mismas reglas están en la API (backend/src/common/utils/validators.ts)
--  y en los formularios (frontend/src/utils/validation.js).
--  Copia de documentación: database/04_documento_telefono_ec.sql
-- ============================================================================

-- Dígito verificador de la cédula (algoritmo módulo 10 del Registro Civil)
CREATE OR REPLACE FUNCTION fn_cedula_ec_valida(p_cedula TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog
AS $$
DECLARE
    v_suma INT := 0;
    v_dig  INT;
    v_prov INT;
BEGIN
    IF p_cedula !~ '^[0-9]{10}$' THEN
        RETURN FALSE;
    END IF;
    v_prov := substr(p_cedula, 1, 2)::INT;
    IF NOT ((v_prov BETWEEN 1 AND 24) OR v_prov = 30) OR substr(p_cedula, 3, 1)::INT > 5 THEN
        RETURN FALSE;
    END IF;
    FOR i IN 1..9 LOOP
        v_dig := substr(p_cedula, i, 1)::INT * CASE WHEN i % 2 = 1 THEN 2 ELSE 1 END;
        IF v_dig > 9 THEN
            v_dig := v_dig - 9;
        END IF;
        v_suma := v_suma + v_dig;
    END LOOP;
    RETURN (10 - v_suma % 10) % 10 = substr(p_cedula, 10, 1)::INT;
END;
$$;

COMMENT ON FUNCTION fn_cedula_ec_valida(TEXT) IS 'TRUE si el texto es una cédula ecuatoriana válida (módulo 10).';

-- 1) Normalizar datos existentes antes de endurecer los dominios
--    +593 9XXXXXXXX → 09XXXXXXXX ; +593 2XXXXXXX → 02XXXXXXX ; espacios/guiones fuera
UPDATE usuario  SET usu_telefono = regexp_replace(usu_telefono, '^\+?593', '0') WHERE usu_telefono ~ '^\+?593[2-79]';
UPDATE operador SET ope_telefono = regexp_replace(ope_telefono, '^\+?593', '0') WHERE ope_telefono ~ '^\+?593[2-79]';

-- 2) Los valores que no cumplen la regla nueva se vacían (son columnas opcionales)
UPDATE usuario  SET usu_telefono = NULL WHERE usu_telefono IS NOT NULL AND usu_telefono !~ '^(09[0-9]{8}|0[2-7][0-9]{7})$';
UPDATE operador SET ope_telefono = NULL WHERE ope_telefono IS NOT NULL AND ope_telefono !~ '^(09[0-9]{8}|0[2-7][0-9]{7})$';
UPDATE usuario          SET usu_documento = NULL WHERE usu_documento IS NOT NULL AND NOT fn_cedula_ec_valida(usu_documento);
UPDATE reserva_pasajero SET pax_documento = NULL WHERE pax_documento IS NOT NULL AND NOT fn_cedula_ec_valida(pax_documento);

-- 3) Reemplazar las reglas de los dominios (se revalidan todas las filas)
ALTER DOMAIN dom_documento DROP CONSTRAINT IF EXISTS dom_documento_check;
ALTER DOMAIN dom_documento ADD CONSTRAINT dom_documento_cedula_ec CHECK (fn_cedula_ec_valida(VALUE));
COMMENT ON DOMAIN dom_documento IS 'Cédula ecuatoriana válida (10 dígitos, provincia y dígito verificador módulo 10).';

ALTER DOMAIN dom_telefono DROP CONSTRAINT IF EXISTS dom_telefono_check;
ALTER DOMAIN dom_telefono ADD CONSTRAINT dom_telefono_ec CHECK (VALUE ~ '^(09[0-9]{8}|0[2-7][0-9]{7})$');
COMMENT ON DOMAIN dom_telefono IS 'Teléfono ecuatoriano: celular 09XXXXXXXX o fijo 0[2-7]XXXXXXX.';

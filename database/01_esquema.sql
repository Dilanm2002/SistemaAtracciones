-- ============================================================================
--  DESCUBRE EC  ·  MODELO RELACIONAL DE BASE DE DATOS
--  Ecommerce de atracciones turisticas con pagos
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  CONVENCION DE NOMBRES (obligatoria en todo el modelo)
--  ---------------------------------------------------------------------------
--  1. Tablas en SINGULAR y en minusculas, sin tildes ni ene:
--         provincia, usuario, orden, pago
--  2. Clave primaria = sigla de la tabla + "_id"
--         provincia  ->  prov_id
--         atraccion  ->  atr_id
--         orden      ->  ord_id
--  3. Clave foranea = EXACTAMENTE el nombre de la clave primaria que referencia
--         atraccion.prov_id  REFERENCES provincia(prov_id)
--         orden.usu_id       REFERENCES usuario(usu_id)
--     Asi la FK en la tabla hija tiene el mismo nombre que la PK en la tabla
--     padre, lo que hace la relacion legible sin consultar el diagrama.
--  4. Tablas puente (N:M) = nombre de las dos tablas unidas por "_" y su PK
--     es la CONCATENACION de las dos PK:
--         atraccion_categoria (atr_id, cat_id)   <- ambas FK y ambas PK
--  5. Atributos en minusculas, sin tildes. Sustantivos en singular.
--  6. Todo importe es NUMERIC(n,2). Nunca FLOAT ni DOUBLE PRECISION.
--  7. Toda FK lleva indice y ON DELETE explicito (nunca el comportamiento
--     por defecto de PostgreSQL).
--
--  NORMALIZACION APLICADA
--  ---------------------------------------------------------------------------
--  - 3FN en todas las tablas: ningun dato depende transitivamente de otro.
--  - "ciudad" y "provincia" NO se guardan como texto dentro de la atraccion:
--    viven en sus propias tablas y llegan por FK.
--  - Los roles NO son una columna en usuario: viven en rol y se asignan
--    mediante la tabla puente usuario_rol (un usuario puede tener varios).
--  - Los datos del pasajero NO se copian en la reserva: viven en
--    reserva_pasajero. Evita duplicar PII (hallazgo DAT-013 del informe).
--  - El precio NO se recalcula al vuelo: la tarifa se versiona en tarifa.
--  - Las listas "incluye / no_incluye / recomendaciones / insignias" que
--    estaban como simple-json se normalizan en inclusion + atraccion_inclusion.
--  - Los horarios que estaban como simple-json pasan a tabla horario.
--
--  EJECUCION
--  ---------------------------------------------------------------------------
--     psql -U postgres -d descubre_ec -f 01_esquema.sql
--  (La API lo aplica sola: backend/src/database/sql/001_modelo_relacional.sql
--   es una copia exacta y un test verifica que no se separen.)
--
--  CAMBIOS AL INTEGRARLO CON LA API (v1.1)
--  ---------------------------------------------------------------------------
--  - fn_actualizar_timestamp asignaba NEW.actualizado_en, columna que no
--    existe (todas llevan prefijo: usu_actualizado_en, atr_...). Cualquier
--    UPDATE sobre usuario/operador/atraccion/orden/reserva fallaba. Ahora la
--    columna se pasa como argumento del trigger.
--  - atraccion.atr_uuid y reserva.res_uuid: identificador PUBLICO (UUID) que
--    exige el contrato OpenAPI. La PK interna sigue siendo BIGINT.
--  - atr_tipo admite PACKAGE (tipo del contrato) y la duracion llega a 720 h
--    (30 dias): hay paquetes de varios dias (p. ej. Cuyabeno, 4 dias).
--  - ciudad.ciu_descripcion y ciudad.ciu_imagen: la ciudad es el "destino"
--    que se muestra en el sitio.
--  - Datos: Bolivar es SIERRA; Archidona pertenece a Napo; "Puerto
--    Francisco" era Puyo; se quita "Morona" (duplicaba a Macas).
--  ============================================================================


-- ============================================================================
--  SECCION 0 · TIPOS BASE
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Dominio: correo electronico valido
CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Dominio: documento de identidad ecuatoriano (10 digitos) o pasaporte
CREATE DOMAIN dom_documento AS VARCHAR(20)
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[A-Z]{1,2}[0-9]{6,9}$');

-- Dominio: RUC de Ecuador (13 digitos)
CREATE DOMAIN dom_ruc AS VARCHAR(13)
    CHECK (VALUE ~ '^[0-9]{13}$');

-- Dominio: telefono internacional
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

-- Dominio: codigo ISO de moneda
CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');

-- Dominio: porcentaje (IVA, descuentos)
CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);

-- Dominio: importe no negativo
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);


-- ============================================================================
--  SECCION 1 · GEOGRAFIA  (region -> provincia -> ciudad)
-- ============================================================================

CREATE TABLE region (
    reg_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reg_nombre  VARCHAR(30)  NOT NULL UNIQUE,
    reg_codigo  CHAR(2)      NOT NULL UNIQUE,
    CONSTRAINT region_nombre_no_vacio CHECK (btrim(reg_nombre) <> '')
);
COMMENT ON TABLE region IS 'Regiones geograficas del Ecuador: SIERRA, COSTA, AMAZONIA, GALAPAGOS.';

-- La provincia es el nivel geografico al que pertenece cada atraccion.
CREATE TABLE provincia (
    prov_id       SMALLINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prov_nombre   VARCHAR(60)    NOT NULL UNIQUE,
    prov_codigo   CHAR(2)        NOT NULL UNIQUE,   -- codigo INEC oficial
    reg_id        SMALLINT       NOT NULL,
    prov_activa   BOOLEAN        NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_provincia_region
        FOREIGN KEY (reg_id) REFERENCES region (reg_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_provincia_reg_id ON provincia (reg_id);

CREATE TABLE ciudad (
    ciu_id       SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ciu_nombre   VARCHAR(80) NOT NULL,
    ciu_codigo   CHAR(6)     NOT NULL UNIQUE,      -- codigo INEC/DANE
    prov_id      SMALLINT    NOT NULL,
    ciu_activa   BOOLEAN     NOT NULL DEFAULT TRUE,
    ciu_descripcion VARCHAR(500),                  -- texto para la pagina del destino
    ciu_imagen   VARCHAR(500),                     -- foto de portada del destino
    CONSTRAINT uq_ciudad_provincia_nombre UNIQUE (prov_id, ciu_nombre),
    -- Clave candidata: permite FKs compuestas (ciu_id, prov_id) desde
    -- atraccion y direccion, garantizando que no se mezclen ciudades
    -- de una provincia con otra.
    CONSTRAINT uq_ciudad_id_provincia UNIQUE (ciu_id, prov_id),
    CONSTRAINT fk_ciudad_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_ciudad_prov_id ON ciudad (prov_id);


-- ============================================================================
--  SECCION 2 · IDENTIDAD, ROLES Y ACCESO
-- ============================================================================

-- Los roles NO son una columna de usuario: son una tabla aparte.
CREATE TABLE rol (
    rol_id         SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol_nombre     VARCHAR(30)  NOT NULL UNIQUE,   -- ADMIN, OPERADOR, CLIENTE
    rol_descripcion VARCHAR(200) NOT NULL,
    rol_activo     BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Usuario: identidad. Sin columna de rol.
CREATE TABLE usuario (
    usu_id         BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_correo     dom_correo    NOT NULL UNIQUE,
    usu_password   VARCHAR(100)  NOT NULL,          -- bcrypt, NUNCA texto plano
    usu_nombre     VARCHAR(120)  NOT NULL,
    usu_apellido   VARCHAR(120)  NOT NULL,
    usu_documento  dom_documento UNIQUE,
    usu_telefono   dom_telefono,
    usu_fecha_nacimiento DATE,
    usu_avatar     VARCHAR(255),
    usu_verificado BOOLEAN       NOT NULL DEFAULT FALSE,
    usu_activo     BOOLEAN       NOT NULL DEFAULT TRUE,
    usu_ultimo_acceso TIMESTAMPTZ,
    usu_creado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    usu_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usuario_nombres_no_vacios
        CHECK (btrim(usu_nombre) <> '' AND btrim(usu_apellido) <> '')
);

-- Tabla puente N:M. Un usuario puede tener VARIOS roles.
-- La PK compuesta es la concatenacion de las dos FK.
CREATE TABLE usuario_rol (
    usu_id       BIGINT      NOT NULL,
    rol_id       SMALLINT    NOT NULL,
    usr_asignado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    usr_asignado_por BIGINT,                        -- admin que lo asigno
    CONSTRAINT pk_usuario_rol PRIMARY KEY (usu_id, rol_id),
    CONSTRAINT fk_usuario_rol_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_usuario_rol_rol
        FOREIGN KEY (rol_id) REFERENCES rol (rol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_usuario_rol_asignador
        FOREIGN KEY (usr_asignado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_usuario_rol_rol_id ON usuario_rol (rol_id);
CREATE INDEX ix_usuario_rol_asignado_por ON usuario_rol (usr_asignado_por);

-- Sesiones / refresh tokens (permite revocar el acceso al desactivar al usuario)
CREATE TABLE sesion (
    ses_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    usu_id          BIGINT       NOT NULL,
    ses_token_hash  VARCHAR(128) NOT NULL UNIQUE,   -- SHA-256, nunca el token
    ses_ip          VARCHAR(45),
    ses_user_agent  VARCHAR(255),
    ses_expira_en   TIMESTAMPTZ  NOT NULL,
    ses_revocada    BOOLEAN      NOT NULL DEFAULT FALSE,
    ses_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_sesion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_sesion_usu_id ON sesion (usu_id);
CREATE INDEX ix_sesion_expira_en ON sesion (ses_expira_en);

-- Verificacion de correo electronico
CREATE TABLE token_verificacion (
    tokv_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id         BIGINT       NOT NULL,
    tokv_token     VARCHAR(128) NOT NULL UNIQUE,
    tokv_tipo      VARCHAR(20)  NOT NULL,           -- EMAIL, RECUPERACION
    tokv_expira_en TIMESTAMPTZ  NOT NULL,
    tokv_usado     BOOLEAN      NOT NULL DEFAULT FALSE,
    tokv_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_token_verificacion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT token_verificacion_tipo_valido
        CHECK (tokv_tipo IN ('EMAIL', 'RECUPERACION'))
);
CREATE INDEX ix_token_verificacion_usu_id ON token_verificacion (usu_id);

-- Direcciones (facturacion / entrega)
CREATE TABLE direccion (
    dir_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id        BIGINT      NOT NULL,
    prov_id       SMALLINT    NOT NULL,
    ciu_id        SMALLINT    NOT NULL,
    dir_linea1    VARCHAR(200) NOT NULL,
    dir_linea2    VARCHAR(200),
    dir_codigo_postal VARCHAR(10),
    dir_es_principal BOOLEAN  NOT NULL DEFAULT FALSE,
    dir_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_direccion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_direccion_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- FK compuesta: garantiza que la ciudad pertenece a la provincia declarada
    CONSTRAINT fk_direccion_ciudad
        FOREIGN KEY (ciu_id, prov_id) REFERENCES ciudad (ciu_id, prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
-- Solo un usuario puede tener UNA direccion principal (indice parcial:
-- la restriccion UNIQUE (usu_id, dir_es_principal) estaria mal porque
-- tambien limitaria a una sola direccion NO principal por usuario).
CREATE UNIQUE INDEX ux_direccion_principal
    ON direccion (usu_id) WHERE dir_es_principal;
CREATE INDEX ix_direccion_usu_id ON direccion (usu_id);
CREATE INDEX ix_direccion_prov_id ON direccion (prov_id);
CREATE INDEX ix_direccion_ciu_id ON direccion (ciu_id);


-- ============================================================================
--  SECCION 3 · CATALOGO COMERCIAL
-- ============================================================================

-- Empresa que opera el tour. En Ecuador es un contribuyente con RUC.
CREATE TABLE operador (
    ope_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_codigo    INTEGER      NOT NULL UNIQUE,     -- codigo legado del contrato
    ope_nombre    VARCHAR(150) NOT NULL,
    ope_ruc       dom_ruc      UNIQUE,
    ope_correo    dom_correo,
    ope_telefono  dom_telefono,
    ope_direccion VARCHAR(255),
    prov_id       SMALLINT     NOT NULL,            -- provincia de la sede
    ope_activo    BOOLEAN      NOT NULL DEFAULT TRUE,
    ope_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ope_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_operador_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_operador_prov_id ON operador (prov_id);

-- Que usuarios pertenecen a que operador (resuelve el problema del
-- "operadorCodigo suelto" que estaba dentro de usuario)
CREATE TABLE operador_usuario (
    ope_id      BIGINT      NOT NULL,
    usu_id      BIGINT      NOT NULL,
    opeu_cargo  VARCHAR(60) NOT NULL,               -- ADMIN, VENDEDOR, GUIA
    opeu_activo BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_operador_usuario PRIMARY KEY (ope_id, usu_id),
    CONSTRAINT fk_operador_usuario_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_operador_usuario_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_operador_usuario_usu_id ON operador_usuario (usu_id);

-- Categoria jerarquica (padre_hijo). Antes era una tabla plana.
CREATE TABLE categoria (
    cat_id         INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cat_padre_id   INTEGER,                          -- autorreferencia
    cat_nombre     VARCHAR(80) NOT NULL,
    cat_slug       VARCHAR(80) NOT NULL UNIQUE,
    cat_descripcion VARCHAR(255),
    cat_icono      VARCHAR(40) NOT NULL DEFAULT 'map-pin',
    cat_orden      SMALLINT    NOT NULL DEFAULT 0,
    cat_activa     BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_categoria_padre
        FOREIGN KEY (cat_padre_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT categoria_no_es_ella_misma CHECK (cat_padre_id IS DISTINCT FROM cat_id)
);
CREATE INDEX ix_categoria_cat_padre_id ON categoria (cat_padre_id);

-- Idioma disponible (los que estaban en el simple-json "idiomas")
CREATE TABLE idioma (
    idi_id     SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idi_codigo CHAR(2)      NOT NULL UNIQUE,        -- ISO 639-1
    idi_nombre VARCHAR(50)  NOT NULL
);

-- Item de la lista "incluye / no_incluye / recomendaciones"
CREATE TABLE inclusion (
    inc_id     INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inc_tipo   VARCHAR(20) NOT NULL,                -- INCLUYE, NO_INCLUYE, RECOMENDACION
    inc_nombre VARCHAR(150) NOT NULL,
    inc_orden  SMALLINT    NOT NULL DEFAULT 0,
    CONSTRAINT uq_inclusion_tipo_nombre UNIQUE (inc_tipo, inc_nombre),
    CONSTRAINT inclusion_tipo_valido
        CHECK (inc_tipo IN ('INCLUYE', 'NO_INCLUYE', 'RECOMENDACION'))
);
CREATE INDEX ix_inclusion_inc_tipo ON inclusion (inc_tipo);

-- La atraccion es el producto. Apunta a la PROVINCIA y a la CIUDAD,
-- nunca guarda el nombre de esos lugares como texto.
CREATE TABLE atraccion (
    atr_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_uuid            UUID          NOT NULL DEFAULT gen_random_uuid(),  -- id publico del contrato
    atr_nombre          VARCHAR(200)  NOT NULL,
    atr_slug            VARCHAR(220)  NOT NULL UNIQUE,
    atr_descripcion     TEXT          NOT NULL,
    atr_descripcion_corta VARCHAR(280),
    atr_tipo            VARCHAR(30)   NOT NULL,   -- GUIDED_TOUR, ADMISSION, DAY_TRIP, TRANSPORT, PACKAGE
    atr_estado          VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR',  -- BORRADOR, PUBLICADA, INACTIVA
    atr_latitud         NUMERIC(10,6) NOT NULL,
    atr_longitud        NUMERIC(10,6) NOT NULL,
    atr_direccion       VARCHAR(255),
    atr_punto_encuentro VARCHAR(255),
    atr_duracion_horas  NUMERIC(5,2)  NOT NULL,
    atr_moneda          dom_moneda    NOT NULL DEFAULT 'USD',
    prov_id            SMALLINT      NOT NULL,     -- FK a provincia
    ciu_id             SMALLINT      NOT NULL,     -- FK a ciudad
    ope_id             BIGINT        NOT NULL,
    atr_cancelacion_gratuita BOOLEAN  NOT NULL DEFAULT FALSE,
    atr_horas_cancelacion   SMALLINT  NOT NULL DEFAULT 24,
    atr_destacada       BOOLEAN       NOT NULL DEFAULT FALSE,
    atr_calificacion_promedio NUMERIC(3,2) NOT NULL DEFAULT 0,
    atr_numero_resenas  INTEGER       NOT NULL DEFAULT 0,
    atr_creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_eliminado_en    TIMESTAMPTZ,               -- borrado logico
    CONSTRAINT uq_atraccion_uuid UNIQUE (atr_uuid),
    CONSTRAINT atraccion_duracion_valida
        CHECK (atr_duracion_horas > 0 AND atr_duracion_horas <= 720),
    CONSTRAINT atraccion_calificacion_valida
        CHECK (atr_calificacion_promedio >= 0 AND atr_calificacion_promedio <= 5),
    CONSTRAINT atraccion_latitud_valida
        CHECK (atr_latitud BETWEEN -90 AND 90),
    CONSTRAINT atraccion_longitud_valida
        CHECK (atr_longitud BETWEEN -180 AND 180),
    CONSTRAINT atraccion_horas_cancelacion_valida
        CHECK (atr_horas_cancelacion >= 0),
    CONSTRAINT atraccion_tipo_valido
        CHECK (atr_tipo IN ('GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE')),
    CONSTRAINT atraccion_estado_valido
        CHECK (atr_estado IN ('BORRADOR', 'PUBLICADA', 'INACTIVA')),
    -- FK de ubicacion: la atraccion pertenece a una provincia y a una ciudad
    CONSTRAINT fk_atraccion_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- FK compuesta: impide que la ciudad sea de OTRA provincia
    CONSTRAINT fk_atraccion_ciudad
        FOREIGN KEY (ciu_id, prov_id) REFERENCES ciudad (ciu_id, prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_atraccion_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_prov_id ON atraccion (prov_id);
CREATE INDEX ix_atraccion_ciu_id  ON atraccion (ciu_id);
CREATE INDEX ix_atraccion_ope_id  ON atraccion (ope_id);
CREATE INDEX ix_atraccion_estado  ON atraccion (atr_estado);
CREATE INDEX ix_atraccion_slug    ON atraccion (atr_slug);
-- Indice trigramatico para el buscador de texto libre (ILIKE '%q%')
CREATE INDEX ix_atraccion_busqueda
    ON atraccion USING gin ((atr_nombre || ' ' || atr_descripcion) gin_trgm_ops);

COMMENT ON COLUMN atraccion.prov_id IS
    'FK a provincia: geografia a la que pertenece la atraccion.';

-- N:M atraccion <-> categoria
CREATE TABLE atraccion_categoria (
    atr_id     BIGINT   NOT NULL,
    cat_id     INTEGER  NOT NULL,
    CONSTRAINT pk_atraccion_categoria PRIMARY KEY (atr_id, cat_id),
    CONSTRAINT fk_atraccion_categoria_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_categoria_categoria
        FOREIGN KEY (cat_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_categoria_cat_id ON atraccion_categoria (cat_id);

-- N:M atraccion <-> idioma
CREATE TABLE atraccion_idioma (
    atr_id     BIGINT   NOT NULL,
    idi_id     SMALLINT NOT NULL,
    CONSTRAINT pk_atraccion_idioma PRIMARY KEY (atr_id, idi_id),
    CONSTRAINT fk_atraccion_idioma_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_idioma_idioma
        FOREIGN KEY (idi_id) REFERENCES idioma (idi_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_idioma_idi_id ON atraccion_idioma (idi_id);

-- N:M atraccion <-> inclusion (normaliza el simple-json)
CREATE TABLE atraccion_inclusion (
    atr_id     BIGINT   NOT NULL,
    inc_id     INTEGER  NOT NULL,
    CONSTRAINT pk_atraccion_inclusion PRIMARY KEY (atr_id, inc_id),
    CONSTRAINT fk_atraccion_inclusion_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_inclusion_inclusion
        FOREIGN KEY (inc_id) REFERENCES inclusion (inc_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_inclusion_inc_id ON atraccion_inclusion (inc_id);

-- Fotos (normaliza el simple-json "fotos")
CREATE TABLE atraccion_foto (
    fot_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id        BIGINT       NOT NULL,
    fot_url       VARCHAR(500) NOT NULL,
    fot_alt       VARCHAR(200) NOT NULL,           -- texto alternativo (WCAG 1.1.1)
    fot_orden     SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT fk_atraccion_foto_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_foto_atr_id ON atraccion_foto (atr_id);

-- Horarios de salida (normaliza el simple-json "horarios")
CREATE TABLE horario (
    hor_id     BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id     BIGINT      NOT NULL,
    hor_hora   TIME        NOT NULL,
    hor_cupo   INTEGER     NOT NULL DEFAULT 20,
    hor_activo BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT horario_cupo_positivo CHECK (hor_cupo > 0),
    CONSTRAINT uq_horario_atraccion_hora UNIQUE (atr_id, hor_hora),
    CONSTRAINT fk_horario_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_horario_atr_id ON horario (atr_id);

-- Tarifas versionadas. El precio no se recalcula al vuelo: se guarda el
-- precio aplicado en el momento de la compra.
CREATE TABLE tarifa (
    tar_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id        BIGINT      NOT NULL,
    tar_tipo      VARCHAR(20) NOT NULL,             -- ADULTO, NINO, MAYOR, GRUPO
    tar_precio    dom_importe NOT NULL,
    tar_moneda    dom_moneda  NOT NULL DEFAULT 'USD',
    tar_vigente_desde DATE    NOT NULL DEFAULT CURRENT_DATE,
    tar_vigente_hasta DATE,                         -- NULL = vigente
    CONSTRAINT uq_tarifa_atraccion_tipo_desde
        UNIQUE (atr_id, tar_tipo, tar_vigente_desde),
    CONSTRAINT tarifa_tipo_valido
        CHECK (tar_tipo IN ('ADULTO', 'NINO', 'MAYOR', 'GRUPO')),
    CONSTRAINT tarifa_vigencia_valida
        CHECK (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= tar_vigente_desde),
    CONSTRAINT fk_tarifa_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_tarifa_atr_id ON tarifa (atr_id);

-- Disponibilidad: cupo por fecha y horario (inventario)
CREATE TABLE disponibilidad (
    dis_id           BIGINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id           BIGINT    NOT NULL,
    hor_id           BIGINT    NOT NULL,
    dis_fecha        DATE      NOT NULL,
    dis_cupo_total   INTEGER   NOT NULL,
    dis_cupo_reservado INTEGER  NOT NULL DEFAULT 0,
    dis_cerrada      BOOLEAN   NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_disponibilidad_atraccion_fecha_horario
        UNIQUE (atr_id, dis_fecha, hor_id),
    CONSTRAINT disponibilidad_cupos_validos
        CHECK (dis_cupo_total > 0
               AND dis_cupo_reservado >= 0
               AND dis_cupo_reservado <= dis_cupo_total),
    CONSTRAINT fk_disponibilidad_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_disponibilidad_horario
        FOREIGN KEY (hor_id) REFERENCES horario (hor_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_disponibilidad_atr_id ON disponibilidad (atr_id);
CREATE INDEX ix_disponibilidad_hor_id ON disponibilidad (hor_id);
CREATE INDEX ix_disponibilidad_fecha   ON disponibilidad (dis_fecha);

-- Dias en que la atraccion no opera
CREATE TABLE fecha_bloqueada (
    fb_id       BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id      BIGINT       NOT NULL,
    fb_fecha    DATE         NOT NULL,
    fb_motivo   VARCHAR(200) NOT NULL,
    fb_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fecha_bloqueada_atraccion_fecha UNIQUE (atr_id, fb_fecha),
    CONSTRAINT fk_fecha_bloqueada_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_fecha_bloqueada_atr_id ON fecha_bloqueada (atr_id);

-- Resenas
CREATE TABLE resena (
    ren_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id          BIGINT       NOT NULL,
    usu_id          BIGINT,                        -- puede ser anonima
    ren_autor_nombre VARCHAR(120) NOT NULL,
    ren_puntuacion  SMALLINT     NOT NULL,
    ren_comentario  VARCHAR(1000) NOT NULL,
    ren_visible     BOOLEAN      NOT NULL DEFAULT TRUE,
    ren_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT resena_puntuacion_valida CHECK (ren_puntuacion BETWEEN 1 AND 5),
    CONSTRAINT uq_resena_atraccion_usuario UNIQUE (atr_id, usu_id),
    CONSTRAINT fk_resena_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_resena_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_resena_atr_id ON resena (atr_id);
CREATE INDEX ix_resena_usu_id ON resena (usu_id);


-- ============================================================================
--  SECCION 4 · CATALOGOS DE ESTADO Y METODOS
-- ============================================================================

CREATE TABLE estado (
    est_id     SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20)  NOT NULL UNIQUE,
    est_nombre VARCHAR(50)  NOT NULL,
    est_grupo  VARCHAR(20)  NOT NULL,              -- ORDEN, PAGO, RESERVA, FACTURA
    est_final   BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_estado_est_grupo ON estado (est_grupo);

CREATE TABLE metodo_pago (
    mpa_id        SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mpa_codigo    VARCHAR(20)  NOT NULL UNIQUE,    -- TARJETA, TRANSFERENCIA, EN_SITIO
    mpa_nombre    VARCHAR(60)  NOT NULL,
    mpa_requiere_datos BOOLEAN  NOT NULL DEFAULT FALSE,
    mpa_activo    BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Cupones de descuento
CREATE TABLE cupon (
    cup_id        BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cup_codigo    VARCHAR(30)   NOT NULL UNIQUE,
    cup_tipo      VARCHAR(20)   NOT NULL,           -- PORCENTAJE, FIJO
    cup_valor     dom_importe   NOT NULL,
    cup_fecha_inicio DATE       NOT NULL,
    cup_fecha_fin DATE,
    cup_usos_max  INTEGER,
    cup_usos_actuales INTEGER    NOT NULL DEFAULT 0,
    cup_activo    BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT cupon_tipo_valido CHECK (cup_tipo IN ('PORCENTAJE', 'FIJO')),
    CONSTRAINT cupon_vigencia_valida
        CHECK (cup_fecha_fin IS NULL OR cup_fecha_fin >= cup_fecha_inicio),
    CONSTRAINT cupon_usos_valido
        CHECK (cup_usos_max IS NULL OR cup_usos_max > 0),
    CONSTRAINT cupon_porcentaje_valido
        CHECK (cup_tipo <> 'PORCENTAJE' OR cup_valor <= 100)
);
CREATE INDEX ix_cupon_activo ON cupon (cup_activo);


-- ============================================================================
--  SECCION 5 · ECOMMERCE: ORDEN, PAGO, FACTURA
-- ============================================================================

-- Cabecera comercial. El pago cuelga de la orden, no de la reserva.
CREATE TABLE orden (
    ord_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_numero          VARCHAR(20)   NOT NULL UNIQUE,
    usu_id              BIGINT        NOT NULL,
    est_id              SMALLINT      NOT NULL,     -- PENDIENTE, PAGADA, ...
    mpa_id              SMALLINT,                   -- metodo elegido
    ord_fecha           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ord_subtotal        dom_importe   NOT NULL DEFAULT 0,
    ord_descuento       dom_importe   NOT NULL DEFAULT 0,
    ord_iva             dom_importe   NOT NULL DEFAULT 0,
    ord_total           dom_importe   NOT NULL DEFAULT 0,
    ord_moneda          dom_moneda    NOT NULL DEFAULT 'USD',
    ord_observaciones   VARCHAR(500),
    ord_creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ord_actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT orden_totales_no_negativos
        CHECK (ord_subtotal >= 0 AND ord_descuento >= 0
               AND ord_iva >= 0 AND ord_total >= 0),
    CONSTRAINT fk_orden_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_orden_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_orden_metodo_pago
        FOREIGN KEY (mpa_id) REFERENCES metodo_pago (mpa_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    -- El cupon aplicado NO vive aqui: esta en orden_cupon (N:M),
    -- asi una orden puede combinar varios cupones sin duplicar la FK.
);
CREATE INDEX ix_orden_usu_id ON orden (usu_id);
CREATE INDEX ix_orden_est_id ON orden (est_id);
CREATE INDEX ix_orden_fecha  ON orden (ord_fecha DESC);
CREATE INDEX ix_orden_mpa_id ON orden (mpa_id);

-- Linea de la orden. Congela el precio unitario aplicado en el momento.
CREATE TABLE orden_detalle (
    det_id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id               BIGINT      NOT NULL,
    atr_id               BIGINT      NOT NULL,
    det_descripcion      VARCHAR(255) NOT NULL,     -- snapshot del nombre
    det_cantidad         INTEGER     NOT NULL,
    det_precio_unitario  dom_importe NOT NULL,       -- snapshot del precio
    det_subtotal         dom_importe NOT NULL,
    CONSTRAINT orden_detalle_cantidad_valida CHECK (det_cantidad > 0),
    CONSTRAINT fk_orden_detalle_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_orden_detalle_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_orden_detalle_ord_id ON orden_detalle (ord_id);
CREATE INDEX ix_orden_detalle_atr_id ON orden_detalle (atr_id);

-- Uso de cupones por usuario (evita reutilizarlos)
CREATE TABLE orden_cupon (
    ord_id  BIGINT NOT NULL,
    cup_id  BIGINT NOT NULL,
    orc_usado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_orden_cupon PRIMARY KEY (ord_id, cup_id),
    CONSTRAINT fk_orden_cupon_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_orden_cupon_cupon
        FOREIGN KEY (cup_id) REFERENCES cupon (cup_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_orden_cupon_cup_id ON orden_cupon (cup_id);


-- ============================================================================
--  SECCION 5 · CARRITO Y FAVORITOS
-- ============================================================================
-- El carrito es una cabecera; las lineas viven en carrito_item.
-- Al confirmar, el carrito se convierte en orden + orden_detalle.

-- Cabecera del carrito. Un usuario puede tener varios carritos
-- (uno activo + varios abandonados) y se marca cual esta activo.
CREATE TABLE carrito (
    car_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id        BIGINT      NOT NULL,
    car_activo    BOOLEAN     NOT NULL DEFAULT TRUE,
    car_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    car_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_carrito_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_carrito_usu_id ON carrito (usu_id);
-- Solo UN carrito activo por usuario.
CREATE UNIQUE INDEX ux_carrito_activo
    ON carrito (usu_id) WHERE car_activo;

-- Linea del carrito: una atraccion + fecha + cantidad de personas.
CREATE TABLE carrito_item (
    ca_id        BIGINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    car_id      BIGINT    NOT NULL,
    atr_id      BIGINT    NOT NULL,
    dis_id      BIGINT,                      -- dia/horario elegido (opcional)
    cai_adultos INTEGER   NOT NULL DEFAULT 1,
    cai_ninos   INTEGER   NOT NULL DEFAULT 0,
    cai_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT carrito_item_cantidades_validas
        CHECK (cai_adultos > 0 AND cai_ninos >= 0),
    CONSTRAINT uq_carrito_item UNIQUE (car_id, atr_id, dis_id),
    CONSTRAINT fk_carrito_item_carrito
        FOREIGN KEY (car_id) REFERENCES carrito (car_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_carrito_item_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_carrito_item_disponibilidad
        FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_carrito_item_car_id ON carrito_item (car_id);
CREATE INDEX ix_carrito_item_atr_id ON carrito_item (atr_id);
CREATE INDEX ix_carrito_item_dis_id ON carrito_item (dis_id);

-- Favorito / wishlist del usuario.
CREATE TABLE favorito (
    fav_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id        BIGINT      NOT NULL,
    atr_id        BIGINT      NOT NULL,
    fav_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_favorito UNIQUE (usu_id, atr_id),   -- no duplicar
    CONSTRAINT fk_favorito_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_favorito_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_favorito_usu_id ON favorito (usu_id);
CREATE INDEX ix_favorito_atr_id ON favorito (atr_id);

-- Transaccion de pago (separada de la orden: una orden puede reintentarse)
CREATE TABLE pago (
    pag_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_numero          VARCHAR(30) NOT NULL UNIQUE,
    ord_id              BIGINT      NOT NULL,
    mpa_id              SMALLINT    NOT NULL,
    est_id              SMALLINT    NOT NULL,       -- PENDIENTE, APROBADO, RECHAZADO, REEMBOLSADO
    pag_monto           dom_importe NOT NULL,
    pag_moneda          dom_moneda  NOT NULL DEFAULT 'USD',
    pag_referencia      VARCHAR(100),               -- id de la pasarela
    pag_autorizacion    VARCHAR(100),
    pag_fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
    pag_aprobado_en     TIMESTAMPTZ,
    pag_rechazado_en     TIMESTAMPTZ,
    pag_motivo_rechazo  VARCHAR(300),
    pag_creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pago_monto_valido CHECK (pag_monto > 0),
    CONSTRAINT fk_pago_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pago_metodo_pago
        FOREIGN KEY (mpa_id) REFERENCES metodo_pago (mpa_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_pago_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_pago_ord_id ON pago (ord_id);
CREATE INDEX ix_pago_est_id ON pago (est_id);
CREATE INDEX ix_pago_fecha   ON pago (pag_fecha DESC);
CREATE INDEX ix_pago_mpa_id  ON pago (mpa_id);
CREATE UNIQUE INDEX ux_pago_orden_aprobado
    ON pago (ord_id) WHERE pag_aprobado_en IS NOT NULL;

-- Detalle de tarjeta. NUNCA se guarda el numero de tarjeta (PCI-DSS):
-- solo ultimos 4 digitos, marca y titular cifrado por la pasarela.
CREATE TABLE pago_tarjeta (
    pat_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id          BIGINT       NOT NULL,
    pat_marca       VARCHAR(20)  NOT NULL,          -- VISA, MASTERCARD, AMEX
    pat_ultimos4    CHAR(4)      NOT NULL,
    pat_titular     VARCHAR(120) NOT NULL,
    pat_mes         SMALLINT     NOT NULL,
    pat_anio        SMALLINT     NOT NULL,
    pat_pais        CHAR(2)      NOT NULL,
    CONSTRAINT pago_tarjeta_mes_valido CHECK (pat_mes BETWEEN 1 AND 12),
    CONSTRAINT pago_tarjeta_anio_valido CHECK (pat_anio BETWEEN 2020 AND 2100),
    CONSTRAINT pago_tarjeta_ultimos4_formato CHECK (pat_ultimos4 ~ '^[0-9]{4}$'),
    CONSTRAINT uq_pago_tarjeta_pag_id UNIQUE (pag_id),
    CONSTRAINT fk_pago_tarjeta_pago
        FOREIGN KEY (pag_id) REFERENCES pago (pag_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_pago_tarjeta_pag_id ON pago_tarjeta (pag_id);

-- Comprobante de transferencia bancaria
CREATE TABLE pago_transferencia (
    ptr_id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id         BIGINT      NOT NULL,
    ptr_banco      VARCHAR(60) NOT NULL,
    ptr_numero_comprobante VARCHAR(40) NOT NULL,
    ptr_fecha_transferencia DATE NOT NULL,
    ptr_archivo_adjunto VARCHAR(500),
    CONSTRAINT uq_pago_transferencia_pag_id UNIQUE (pag_id),
    CONSTRAINT fk_pago_transferencia_pago
        FOREIGN KEY (pag_id) REFERENCES pago (pag_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_pago_transferencia_pag_id ON pago_transferencia (pag_id);

-- Factura electronica (SRI)
CREATE TABLE factura (
    fac_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id              BIGINT      NOT NULL,
    fac_numero          VARCHAR(20) NOT NULL UNIQUE,
    fac_clave_acceso    VARCHAR(49),                -- clave de acceso SRI
    fac_autorizacion_sri VARCHAR(49),
    est_id              SMALLINT    NOT NULL,
    fac_emitida_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    fac_subtotal        dom_importe NOT NULL,
    fac_iva             dom_importe NOT NULL DEFAULT 0,
    fac_total           dom_importe NOT NULL,
    fac_razon_social    VARCHAR(150),
    fac_ruc             dom_ruc,
    CONSTRAINT uq_factura_orden UNIQUE (ord_id),
    CONSTRAINT fk_factura_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_factura_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_factura_ord_id ON factura (ord_id);
CREATE INDEX ix_factura_est_id ON factura (est_id);

-- Devolucion de dinero. Nace de un pago APROBADO, no de la orden:
-- un mismo pago puede reembolsarse en varias cuotas o veces.
CREATE TABLE reembolso (
    rem_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id              BIGINT      NOT NULL,
    rem_numero          VARCHAR(30) NOT NULL UNIQUE,
    rem_monto           dom_importe NOT NULL,
    rem_moneda          dom_moneda  NOT NULL DEFAULT 'USD',
    rem_motivo          VARCHAR(300),
    rem_referencia      VARCHAR(100),              -- id del reembolso en la pasarela
    rem_solicitado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    rem_procesado_en    TIMESTAMPTZ,
    rem_creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reembolso_monto_valido CHECK (rem_monto > 0),
    CONSTRAINT fk_reembolso_pago
        FOREIGN KEY (pag_id) REFERENCES pago (pag_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_reembolso_pag_id ON reembolso (pag_id);

-- Un pago no puede reembolsarse mas de lo cobrado.
CREATE OR REPLACE FUNCTION fn_reembolso_no_excede_pago()
RETURNS TRIGGER AS $$
DECLARE
    v_monto     dom_importe;
    v_acumulado dom_importe;
BEGIN
    -- La regla solo aplica cuando el reembolso queda PROCESADO.
    IF NEW.rem_procesado_en IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT pag_monto INTO v_monto
    FROM pago WHERE pag_id = NEW.pag_id;

    -- NEW todavia no esta en la tabla, asi que se suma a mano.
    -- Asi funciona igual en INSERT y en UPDATE (el valor viejo ya fue
    -- reemplazado por el UPDATE y no se cuenta dos veces).
    SELECT COALESCE(SUM(rem_monto), 0) + NEW.rem_monto INTO v_acumulado
    FROM reembolso
    WHERE pag_id = NEW.pag_id
      AND rem_procesado_en IS NOT NULL
      AND rem_id <> NEW.rem_id;

    IF v_acumulado > v_monto THEN
        RAISE EXCEPTION
            'Reembolso mayor al pago %: acumulado % > cobrado %',
            NEW.pag_id, v_acumulado, v_monto;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reembolso_no_excede
    BEFORE INSERT OR UPDATE OF rem_monto, rem_procesado_en, pag_id
    ON reembolso
    FOR EACH ROW
    EXECUTE FUNCTION fn_reembolso_no_excede_pago();


-- ============================================================================
--  SECCION 6 · RESERVAS
-- ============================================================================

-- La reserva es un producto reservado. Se apoya en un dia+horario concreto
-- de disponibilidad y cuelga de la linea de orden que la compro.
CREATE TABLE reserva (
    res_id                  BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_uuid                UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- id publico
    res_codigo              VARCHAR(12)   NOT NULL UNIQUE,   -- DEC-7F3K9Q
    det_id                  BIGINT        NOT NULL,          -- linea de orden
    dis_id                  BIGINT        NOT NULL,          -- inventario concreto
    est_id                  SMALLINT      NOT NULL,
    res_fecha               DATE          NOT NULL,
    res_hora                TIME          NOT NULL,
    res_adultos             INTEGER       NOT NULL,
    res_ninos               INTEGER       NOT NULL DEFAULT 0,
    res_numero_tickets      INTEGER       NOT NULL,
    res_precio_unitario     dom_importe   NOT NULL,          -- snapshot
    res_subtotal            dom_importe   NOT NULL,
    res_observaciones       VARCHAR(500),
    res_motivo_cancelacion  VARCHAR(255),
    res_creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    res_actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    res_cancelado_en        TIMESTAMPTZ,
    res_confirmado_en       TIMESTAMPTZ,
    CONSTRAINT reserva_pasajeros_validos
        CHECK (res_adultos > 0 AND res_ninos >= 0),
    CONSTRAINT reserva_total_coherente
        CHECK (res_numero_tickets = res_adultos + res_ninos),
    CONSTRAINT fk_reserva_orden_detalle
        FOREIGN KEY (det_id) REFERENCES orden_detalle (det_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_reserva_disponibilidad
        FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reserva_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_reserva_det_id ON reserva (det_id);
CREATE INDEX ix_reserva_dis_id ON reserva (dis_id);
CREATE INDEX ix_reserva_est_id ON reserva (est_id);
CREATE INDEX ix_reserva_fecha  ON reserva (res_fecha, res_hora);

-- Pasajeros de la reserva. La PII vive aqui y NO se duplica en reserva.
CREATE TABLE reserva_pasajero (
    pax_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_id           BIGINT       NOT NULL,
    pax_nombre       VARCHAR(120) NOT NULL,
    pax_documento    dom_documento,
    pax_fecha_nacimiento DATE,
    pax_es_titular   BOOLEAN      NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_reserva_pasajero_reserva
        FOREIGN KEY (res_id) REFERENCES reserva (res_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_reserva_pasajero_res_id ON reserva_pasajero (res_id);

-- Registro de operaciones idempotentes (evita cobros dobles)
CREATE TABLE idempotencia (
    idem_clave        UUID        NOT NULL,
    idem_sujeto       BIGINT      NOT NULL,        -- usu_id FK
    idem_operacion    VARCHAR(150) NOT NULL,
    idem_request_hash VARCHAR(64) NOT NULL,
    idem_estado       VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS',
    idem_response     JSONB,
    idem_expira_en    TIMESTAMPTZ NOT NULL,
    idem_creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotencia PRIMARY KEY (idem_clave, idem_sujeto),
    CONSTRAINT fk_idempotencia_usuario
        FOREIGN KEY (idem_sujeto) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT idempotencia_estado_valido
        CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_expira_en ON idempotencia (idem_expira_en);


-- ============================================================================
--  SECCION 7 · SOPORTE Y AUDITORIA
-- ============================================================================

CREATE TABLE mensaje_contacto (
    men_id       BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    men_nombre   VARCHAR(120) NOT NULL,
    men_correo   dom_correo   NOT NULL,
    men_asunto   VARCHAR(30)  NOT NULL,
    men_cuerpo   VARCHAR(2000) NOT NULL,
    men_leido    BOOLEAN      NOT NULL DEFAULT FALSE,
    men_creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensaje_contacto_leido ON mensaje_contacto (men_leido);

CREATE TABLE bitacora (
    bit_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id        BIGINT,                          -- NULL si es anonimo
    bit_accion    VARCHAR(60) NOT NULL,
    bit_entidad   VARCHAR(60) NOT NULL,
    bit_entidad_id VARCHAR(64),
    bit_detalle   JSONB,
    bit_ip        VARCHAR(45),
    bit_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_bitacora_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_bitacora_usu_id  ON bitacora (usu_id);
CREATE INDEX ix_bitacora_fecha  ON bitacora (bit_creado_en DESC);
CREATE INDEX ix_bitacora_entidad ON bitacora (bit_entidad, bit_entidad_id);


-- ============================================================================
--  SECCION 8 · DISPARADORES DE MANTENIMIENTO
-- ============================================================================

-- Las columnas llevan el prefijo de su tabla (usu_actualizado_en, atr_...),
-- asi que el nombre de la columna llega como argumento del trigger.
CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- carrito usa el prefijo de tabla, asi que no entra en el bucle anterior.
CREATE OR REPLACE FUNCTION fn_actualizar_timestamp_carrito()
RETURNS TRIGGER AS $$
BEGIN
    NEW.car_actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_carrito_actualizado
    BEFORE UPDATE ON carrito
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp_carrito();

-- Se aplica a las tablas con columna "<prefijo>_actualizado_en"
DO $$
DECLARE
    par TEXT[];
BEGIN
    FOREACH par SLICE 1 IN ARRAY ARRAY[
        ['usuario',   'usu_actualizado_en'],
        ['operador',  'ope_actualizado_en'],
        ['atraccion', 'atr_actualizado_en'],
        ['orden',     'ord_actualizado_en'],
        ['reserva',   'res_actualizado_en']
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_actualizado BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp(%L)',
            par[1], par[1], par[2]);
    END LOOP;
END $$;


-- ============================================================================
--  SECCION 9 · VISTAS DE APOYO
-- ============================================================================

-- Vista que "desnormaliza" solo para leer: cada atraccion con su geografia
CREATE VIEW v_atraccion_completa AS
SELECT
    a.atr_id,
    a.atr_nombre,
    a.atr_slug,
    a.atr_estado,
    a.atr_tipo,
    p.prov_nombre       AS provincia,
    c.ciu_nombre       AS ciudad,
    r.reg_nombre       AS region,
    o.ope_nombre       AS operador,
    o.ope_ruc          AS operador_ruc
FROM atraccion a
JOIN provincia p ON p.prov_id = a.prov_id
JOIN ciudad    c ON c.ciu_id  = a.ciu_id
JOIN region    r ON r.reg_id  = p.reg_id
JOIN operador  o ON o.ope_id  = a.ope_id;

COMMENT ON VIEW v_atraccion_completa IS
    'Atracciones con provincia, ciudad, region y operador resueltos por FK.';

-- Vista: permisos efectivos de un usuario (usuario -> rol)
CREATE VIEW v_usuario_roles AS
SELECT
    u.usu_id,
    u.usu_correo,
    u.usu_nombre,
    u.usu_apellido,
    r.rol_id,
    r.rol_nombre
FROM usuario u
JOIN usuario_rol ur ON ur.usu_id = u.usu_id
JOIN rol r          ON r.rol_id  = ur.rol_id
WHERE u.usu_activo AND r.rol_activo;

-- Vista: detalle financiero de la orden
CREATE VIEW v_orden_financiero AS
SELECT
    o.ord_id,
    o.ord_numero,
    o.ord_fecha,
    u.usu_correo,
    COALESCE(SUM(det.det_subtotal), 0) AS calculado_subtotal,
    o.ord_subtotal,
    o.ord_descuento,
    o.ord_iva,
    o.ord_total,
    (o.ord_subtotal - o.ord_descuento + o.ord_iva) AS total_recalculado
FROM orden o
JOIN usuario u        ON u.usu_id = o.usu_id
LEFT JOIN orden_detalle det ON det.ord_id = o.ord_id
GROUP BY o.ord_id, o.ord_numero, o.ord_fecha, u.usu_correo,
         o.ord_subtotal, o.ord_descuento, o.ord_iva, o.ord_total;


-- ============================================================================
--  SECCION 10 · DATOS INICIALES (catalogos base)
-- ============================================================================

INSERT INTO region (reg_nombre, reg_codigo) VALUES
    ('SIERRA',   'SI'),
    ('COSTA',    'CO'),
    ('AMAZONIA', 'AM'),
    ('GALAPAGOS','GA');

-- Las 24 provincias del Ecuador, con su region
INSERT INTO provincia (prov_nombre, prov_codigo, reg_id) VALUES
    ('Azuay',                          '01', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Bolívar',                        '02', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Cañar',                          '03', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Carchi',                         '04', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Chimborazo',                     '05', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Cotopaxi',                       '06', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('El Oro',                         '07', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Esmeraldas',                     '08', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Galápagos',                      '09', (SELECT reg_id FROM region WHERE reg_codigo='GA')),
    ('Guayas',                         '10', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Imbabura',                       '11', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Loja',                           '12', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Los Ríos',                       '13', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Manabí',                         '14', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Morona Santiago',                '15', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Napo',                           '16', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Orellana',                       '17', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Pastaza',                        '18', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Pichincha',                      '19', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Santa Elena',                    '20', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Santo Domingo de los Tsáchilas', '21', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Sucumbíos',                      '22', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Tungurahua',                     '23', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Zamora Chinchipe',               '24', (SELECT reg_id FROM region WHERE reg_codigo='AM'));

-- Ciudades principales del Ecuador (codigo INEC/DANE de 6 digitos).
-- Solo una muestra: el resto se carga desde el catalogo oficial.
-- OJO: prov_codigo es un codigo INTERNO 01-24; ciu_codigo es el codigo
-- oficial INEC/DANE de 6 digitos. Son campos independientes y no se
-- relacionan entre si (el vinculo real es la FK prov_id).
INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id) VALUES
    ('Cuenca',                '010100', (SELECT prov_id FROM provincia WHERE prov_nombre='Azuay')),
    ('Guayaquil',             '090150', (SELECT prov_id FROM provincia WHERE prov_nombre='Guayas')),
    ('Quito',                 '170150', (SELECT prov_id FROM provincia WHERE prov_nombre='Pichincha')),
    ('Ambato',                '180150', (SELECT prov_id FROM provincia WHERE prov_nombre='Tungurahua')),
    ('Riobamba',              '060100', (SELECT prov_id FROM provincia WHERE prov_nombre='Chimborazo')),
    ('Loja',                  '130100', (SELECT prov_id FROM provincia WHERE prov_nombre='Loja')),
    ('Puerto Baquerizo Moreno','020100',(SELECT prov_id FROM provincia WHERE prov_nombre='Galápagos')),
    ('Manta',                 '140350', (SELECT prov_id FROM provincia WHERE prov_nombre='Manabí')),
    ('Salinas',               '090300', (SELECT prov_id FROM provincia WHERE prov_nombre='Santa Elena')),
    ('La Troncal',            '030050', (SELECT prov_id FROM provincia WHERE prov_nombre='Cañar')),
    ('Ibarra',                '100150', (SELECT prov_id FROM provincia WHERE prov_nombre='Imbabura')),
    ('Tulcan',                '040100', (SELECT prov_id FROM provincia WHERE prov_nombre='Carchi')),
    ('Latacunga',             '050100', (SELECT prov_id FROM provincia WHERE prov_nombre='Cotopaxi')),
    ('Macas',                 '160100', (SELECT prov_id FROM provincia WHERE prov_nombre='Morona Santiago')),
    ('Puyo',                  '190150', (SELECT prov_id FROM provincia WHERE prov_nombre='Pastaza')),
    ('Archidona',             '170350', (SELECT prov_id FROM provincia WHERE prov_nombre='Napo')),
    ('Nueva Loja',            '230100', (SELECT prov_id FROM provincia WHERE prov_nombre='Sucumbíos'));

INSERT INTO rol (rol_nombre, rol_descripcion) VALUES
    ('ADMIN',    'Administrador total del marketplace'),
    ('OPERADOR', 'Empresa que opera atracciones'),
    ('CLIENTE',  'Usuario que compra y reserva');

INSERT INTO idioma (idi_codigo, idi_nombre) VALUES
    ('es','Espanol'), ('en','Ingles'), ('fr','Frances'), ('de','Aleman');

INSERT INTO metodo_pago (mpa_codigo, mpa_nombre, mpa_requiere_datos) VALUES
    ('TARJETA',      'Tarjeta de credito/debito', TRUE),
    ('TRANSFERENCIA','Transferencia bancaria',     FALSE),
    ('EN_SITIO',     'Pago en el punto de venta',  FALSE),
    ('PAYPHAL',      'PayPal',                     FALSE);

INSERT INTO estado (est_codigo, est_nombre, est_grupo, est_final) VALUES
    ('CREADA',         'Orden creada',        'ORDEN',   FALSE),
    ('PAGADA',         'Orden pagada',        'ORDEN',   TRUE),
    ('CANCELADA',      'Orden cancelada',     'ORDEN',   TRUE),
    ('REEMBOLSADA',    'Orden reembolsada',    'ORDEN',   TRUE),
    ('PENDIENTE',      'Pago pendiente',      'PAGO',    FALSE),
    ('APROBADO',       'Pago aprobado',       'PAGO',    TRUE),
    ('RECHAZADO',      'Pago rechazado',      'PAGO',    TRUE),
    ('FALLIDO',        'Pago fallido',        'PAGO',    TRUE),
    ('CONFIRMADA',     'Reserva confirmada',  'RESERVA', FALSE),
    ('PENDIENTE_PAGO', 'Reserva pendiente',   'RESERVA', FALSE),
    ('CANCELADA_RES',  'Reserva cancelada',   'RESERVA', TRUE),
    ('COMPLETADA',     'Reserva completada',  'RESERVA', TRUE),
    ('NO_PAGADA',      'Factura no pagada',   'FACTURA', FALSE),
    ('PAGADA_FAC',     'Factura pagada',      'FACTURA', TRUE),
    ('ANULADA_FAC',    'Factura anulada',     'FACTURA', TRUE);

INSERT INTO categoria (cat_nombre, cat_slug, cat_descripcion, cat_orden) VALUES
    ('Aventura',   'aventura',   'Deportes extremos y naturaleza', 1),
    ('Cultural',   'cultural',   'Patrimonio e historia',          2),
    ('Naturales',  'naturales',  'Ecosistemas y fauna',            3),
    ('Gastronomia','gastronomia','Comida y bebida local',         4),
    ('Playas',     'playas',     'Costa y litoral',                5),
    ('Montana',    'montana',    'Sierra y senderismo',            6);

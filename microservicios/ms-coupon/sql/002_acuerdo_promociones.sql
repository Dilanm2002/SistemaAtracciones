-- Extras de Descubre EC sobre la sección 9 del script del equipo (solo se AGREGA; avisar al equipo).
--  · Acuerdo B2B de promociones con Booking (contrato v2/v3: GET/PUT /atracciones/promociones/contrato,
--    Consideraciones RDA2 pág. 149). Una sola fila (apr_id = 1) y sus destinos habilitados.
CREATE TABLE acuerdo_promocion (
    apr_id                SMALLINT     PRIMARY KEY DEFAULT 1,
    apr_permite           BOOLEAN      NOT NULL,
    apr_descuento_maximo  NUMERIC(5,2) NOT NULL,
    apr_fecha_acuerdo     DATE         NOT NULL DEFAULT CURRENT_DATE,
    apr_vigencia_hasta    DATE         NOT NULL,
    apr_condiciones       VARCHAR(500),
    apr_contacto_nombre   VARCHAR(120),
    apr_contacto_correo   VARCHAR(160),
    apr_contacto_telefono VARCHAR(16),
    apr_actualizado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT acuerdo_promocion_unico CHECK (apr_id = 1),
    CONSTRAINT acuerdo_promocion_descuento_valido CHECK (apr_descuento_maximo BETWEEN 0 AND 50),
    CONSTRAINT acuerdo_promocion_sin_descuento CHECK (apr_permite OR apr_descuento_maximo = 0),
    CONSTRAINT acuerdo_promocion_correo_valido
        CHECK (apr_contacto_correo IS NULL OR apr_contacto_correo ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
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

-- Valores iniciales (los mismos de la tienda; `npm run migrar` copia los vigentes)
INSERT INTO acuerdo_promocion (apr_permite, apr_descuento_maximo, apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones, apr_contacto_nombre, apr_contacto_correo)
VALUES (TRUE, 15.00, CURRENT_DATE, DATE '2027-12-31',
        'Aplica en paquetes de al menos 2 servicios en la misma ciudad de destino, con un mínimo de 48 horas de anticipación.',
        'Descubre EC', 'reservas@descubre-ec.com');
INSERT INTO acuerdo_promocion_destino (apr_id, apd_destino)
VALUES (1, 'Quito'), (1, 'Baños de Agua Santa'), (1, 'Cuenca'), (1, 'Puerto Ayora');

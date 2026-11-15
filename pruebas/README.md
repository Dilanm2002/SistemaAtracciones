# Pruebas automatizadas con coeficiente Kappa

Un solo script corre las pruebas **unitarias**, de **integración** y **E2E** que ya existen en el proyecto y mide, con el
**coeficiente Kappa de Cohen**, cuánto coincide el resultado obtenido de cada caso con el esperado. No modifica el backend
ni el frontend.

```bash
node pruebas/ejecutar-pruebas.mjs
```

| Capa | Qué corre |
|---|---|
| Unitarias | `frontend/tests` (node --test), `backend` (jest), `gateway`, `bff-web` y la regla de cancelación de `ms-booking` |
| Integración | Los 12 microservicios contra sus bases de prueba (Docker, puerto 5434) y el backend de la tienda contra la suya (5433) |
| E2E | Casos contra la API del gateway (cada uno declara si debe **aceptar** o **rechazar**) y la web en el navegador (Playwright) |

## Antes de correrlo

```bash
cd microservicios && docker compose up -d          # bases de prueba de la integración
bash microservicios/scripts/arrancar-todo.sh        # gateway local para los E2E de la API
```

Si algo no está encendido, esa parte se marca como **omitida** y el resto se ejecuta igual.

## Opciones

| Opción | Efecto |
|---|---|
| `--solo=unitarias,integracion,e2e` | Corre solo esas capas |
| `--e2e-url=https://…` | E2E de la API contra otro gateway; en la nube solo hace consultas que no cambian datos |
| `--e2e-escritura` | En la nube, también crea y cancela reservas de prueba |
| `--sin-navegador` | Omite Playwright |

## Cómo se calcula Kappa

κ = (po − pe) / (1 − pe), donde *po* es la proporción de casos en que lo obtenido coincide con lo esperado y *pe* la coincidencia
esperada por azar. Se interpreta según Landis y Koch (1977): ≤ 0,20 leve · 0,21–0,40 aceptable · 0,41–0,60 moderada ·
0,61–0,80 considerable · > 0,80 casi perfecta. Se calcula por capa y en total. En una capa donde todos los casos se esperan «aprobada», Kappa no aplica (paradoja de prevalencia) y se informa la coincidencia; el Kappa total sí combina las categorías.

El reporte queda en `pruebas/reportes/reporte-<fecha>.md` (y `.json`), con la matriz de confusión, los casos que no coinciden y
los omitidos. El script termina con código 1 si algún caso no coincide, así puede usarse en CI.

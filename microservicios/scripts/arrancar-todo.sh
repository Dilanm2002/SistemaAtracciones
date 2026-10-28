#!/usr/bin/env bash
# Arranca tienda + ms-location + ms-catalog + ms-review + gateway para la prueba con Booking.
# Uso (Git Bash, Docker Desktop encendido):  bash microservicios/scripts/arrancar-todo.sh
# Las claves se leen de backend/.env (BOOKING_API_KEY, JWT_SECRET); nada se imprime.
# Registros en microservicios/logs/<servicio>.log · detener: Ctrl+C
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
MS="$RAIZ/microservicios"
LOGS="$MS/logs"
mkdir -p "$LOGS"

leer() { grep -E "^$1=" "$RAIZ/backend/.env" | tail -1 | cut -d= -f2- | tr -d '"\r'; }
export BOOKING_API_KEY="$(leer BOOKING_API_KEY)"
export JWT_SECRET="$(leer JWT_SECRET)"
export SERVICIOS_TOKEN="${SERVICIOS_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")}"
[ ${#BOOKING_API_KEY} -ge 24 ] || { echo "Falta BOOKING_API_KEY en backend/.env"; exit 1; }

(cd "$RAIZ/backend" && docker compose up -d >/dev/null)
(cd "$MS" && docker compose up -d >/dev/null)

PIDS=()
lanzar() { local nombre=$1 dir=$2; shift 2
  (cd "$dir" && env "$@" npm run dev >"$LOGS/$nombre.log" 2>&1) & PIDS+=($!)
  echo "▶ $nombre  (log: microservicios/logs/$nombre.log)"; }
trap 'echo; echo "Deteniendo…"; kill ${PIDS[@]} 2>/dev/null; exit 0' INT TERM

(cd "$RAIZ/backend" && npm run start:dev >"$LOGS/tienda.log" 2>&1) & PIDS+=($!); echo "▶ tienda  (log: microservicios/logs/tienda.log)"
lanzar ms-location "$MS/ms-location" DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_location
lanzar ms-catalog  "$MS/ms-catalog"  DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_catalog
lanzar ms-review   "$MS/ms-review"   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ms_review
lanzar gateway     "$MS/gateway"

echo "Esperando a que todo responda…"
for i in $(seq 1 90); do
  if curl -fs http://localhost:8080/api/v3/health -H "X-API-Key: $BOOKING_API_KEY" >/dev/null 2>&1; then
    echo "✔ Gateway listo: http://localhost:8080/api/v3"; break; fi
  sleep 2
done
wait

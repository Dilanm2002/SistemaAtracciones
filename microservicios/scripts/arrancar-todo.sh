#!/usr/bin/env bash
# Arranca los 12 microservicios y el gateway (Docker Desktop encendido; la tienda monolítica ya no hace falta).
#   bash microservicios/scripts/arrancar-todo.sh
# Las claves se leen de backend/.env (BOOKING_API_KEY, JWT_SECRET, BOOKING_GRPC_*); nada se imprime.
# Registros en microservicios/logs/<servicio>.log · detener: Ctrl+C
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
MS="$RAIZ/microservicios"
LOGS="$MS/logs"
mkdir -p "$LOGS"

leer() { grep -E "^$1=" "$RAIZ/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"\r'; }
export BOOKING_API_KEY="$(leer BOOKING_API_KEY)"
export JWT_SECRET="$(leer JWT_SECRET)"
export SERVICIOS_TOKEN="${SERVICIOS_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")}"
# Stock y aviso de check-in a Booking: apagados en local salvo que se pidan
export BOOKING_STOCK_ENABLED="${BOOKING_STOCK_ENABLED:-false}"
export BOOKING_AVISOS_ENABLED="${BOOKING_AVISOS_ENABLED:-false}"
export BOOKING_SERVICE_ID="${BOOKING_SERVICE_ID:-NODE_ATR_DILAN}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:8080}"
export FOTOS_BASE_URL="${FOTOS_BASE_URL:-https://sistemaatracciones-backend.vercel.app}"
[ ${#BOOKING_API_KEY} -ge 24 ] || { echo "Falta BOOKING_API_KEY en backend/.env"; exit 1; }

(cd "$MS" && docker compose up -d >/dev/null)
DB="postgresql://postgres:postgres@localhost:5434"

PIDS=()
trap 'echo; echo "Deteniendo…"; kill ${PIDS[@]} 2>/dev/null; exit 0' INT TERM
# lanzar SERVICIO [VAR=valor…]
lanzar() { local s=$1; shift
  (cd "$MS/$s" && env "$@" npm run dev >"$LOGS/$s.log" 2>&1) & PIDS+=($!)
  echo "▶ $s  (log: microservicios/logs/$s.log)"; }

lanzar ms-location  DATABASE_URL=$DB/ms_location
lanzar ms-catalog   DATABASE_URL=$DB/ms_catalog
lanzar ms-review    DATABASE_URL=$DB/ms_review   EVENTOS_DESTINOS=http://localhost:4002/api/v1/internal/eventos
lanzar ms-pricing   DATABASE_URL=$DB/ms_pricing  EVENTOS_DESTINOS=http://localhost:4002/api/v1/internal/eventos
lanzar ms-inventory DATABASE_URL=$DB/ms_inventory EVENTOS_DESTINOS=http://localhost:4008/api/v1/internal/eventos
lanzar ms-coupon    DATABASE_URL=$DB/ms_coupon
lanzar ms-order     DATABASE_URL=$DB/ms_order
lanzar ms-booking   DATABASE_URL=$DB/ms_booking
lanzar ms-payment   DATABASE_URL=$DB/ms_payment
lanzar ms-refund    DATABASE_URL=$DB/ms_refund
lanzar ms-invoicing DATABASE_URL=$DB/ms_invoicing
lanzar ms-identity  DATABASE_URL=$DB/ms_identity
lanzar bff-web
lanzar gateway

echo "Esperando a que todo responda…"
for i in $(seq 1 90); do
  if curl -fs http://localhost:8080/api/v3/health >/dev/null 2>&1; then echo "✔ Gateway listo: http://localhost:8080/api/v3"; break; fi
  sleep 2
done
wait

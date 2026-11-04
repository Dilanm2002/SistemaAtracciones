#!/usr/bin/env bash
# Despliega en Azure Container Apps los 11 microservicios y el gateway que registra Booking.
# Base: el proyecto de Supabase de la tienda, con un schema por microservicio (la tienda queda en `public`
# solo como origen de la copia inicial de datos). gRPC/REST/SOAP entre servicios, como el script del equipo.
#
#   1) cp deploy/azure/.env.example deploy/azure/.env   (y llénalo)
#   2) az login
#   3) bash deploy/azure/desplegar.sh                    (Git Bash, Docker Desktop encendido)
#
# Se puede repetir: la segunda vez sube la imagen nueva, vuelve a copiar el catálogo (no los datos de reservas,
# pagos ni facturas, que ya son de los microservicios) y actualiza la configuración. No necesita conexión directa
# a Supabase desde tu red (todo corre en Azure).
# Al final imprime la URL que se registra en Booking. Nunca imprime claves.
set -euo pipefail
export MSYS_NO_PATHCONV=1
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
# En Git Bash, ruta C:/… : la entienden tanto bash como docker, git y node (programas de Windows)
command -v cygpath >/dev/null && RAIZ="$(cygpath -m "$RAIZ")"
CONF="$RAIZ/deploy/azure/.env"
[ -f "$CONF" ] || { echo "Falta deploy/azure/.env (copia deploy/azure/.env.example)"; exit 1; }

# Lectura literal (las URLs llevan ? y &, que romperían un `source`)
while IFS= read -r linea || [ -n "$linea" ]; do
  linea="${linea%$'\r'}"
  [[ "$linea" =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
  export "${linea%%=*}=${linea#*=}"
done < "$CONF"

faltan=()
for v in AZ_GRUPO AZ_REGION AZ_REGISTRO DATABASE_URL JWT_SECRET BOOKING_API_KEY; do [ -n "${!v:-}" ] || faltan+=("$v"); done
[ ${#faltan[@]} -eq 0 ] || { echo "Completa en deploy/azure/.env: ${faltan[*]}"; exit 1; }
[ ${#BOOKING_API_KEY} -ge 24 ] || { echo "BOOKING_API_KEY debe tener 24+ caracteres"; exit 1; }
[ ${#JWT_SECRET} -ge 32 ] || { echo "JWT_SECRET debe tener 32+ caracteres"; exit 1; }

# Token entre microservicios: se genera una vez y queda guardado en deploy/azure/.env
if [ -z "${SERVICIOS_TOKEN:-}" ]; then
  SERVICIOS_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
  printf '\n# Generado por desplegar.sh (token entre microservicios)\nSERVICIOS_TOKEN=%s\n' "$SERVICIOS_TOKEN" >> "$CONF"
fi

# Los microservicios usan el Session pooler de Supabase (5432) para que cada conexión conserve su schema;
# se acepta la URL de cualquiera de los dos poolers (la del Transaction pooler, 6543, es la de Vercel).
pooler() { node -e "const u=new URL(process.argv[1]);if(!/pooler\.supabase\.com$/.test(u.hostname)){console.error('DATABASE_URL debe ser la del pooler de Supabase (…pooler.supabase.com): Azure no llega a la conexión directa (solo IPv6)');process.exit(1)}u.port=process.argv[2];u.searchParams.delete('pgbouncer');u.searchParams.delete('schema');console.log(u.toString())" "$DATABASE_URL" "$1"; }
MS_DATABASE_URL="$(pooler 5432)"

paso() { echo; echo "▶ $*"; }
az account show --query name -o tsv >/dev/null 2>&1 || { echo "Primero: az login"; exit 1; }
echo "Suscripción: $(az account show --query name -o tsv)"

paso "Proveedores y extensión de Container Apps"
az extension add --name containerapp --upgrade --yes --only-show-errors
for p in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  az provider register --namespace "$p" --wait --only-show-errors
done

paso "Grupo $AZ_GRUPO en $AZ_REGION"
az group create -n "$AZ_GRUPO" -l "$AZ_REGION" -o none

paso "Registro de imágenes $AZ_REGISTRO"
az acr show -n "$AZ_REGISTRO" -o none 2>/dev/null || az acr create -g "$AZ_GRUPO" -n "$AZ_REGISTRO" --sku Basic --admin-enabled true -o none
SERVIDOR="$(az acr show -n "$AZ_REGISTRO" --query loginServer -o tsv)"
ACR_USUARIO="$(az acr credential show -n "$AZ_REGISTRO" --query username -o tsv)"
ACR_CLAVE="$(az acr credential show -n "$AZ_REGISTRO" --query 'passwords[0].value' -o tsv)"
az acr login -n "$AZ_REGISTRO" --only-show-errors


ETIQUETA="$(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo local)-$(date +%Y%m%d%H%M)"
paso "Imagen ($ETIQUETA): los 11 microservicios y el gateway"
docker build -t "$SERVIDOR/descubre-ms:$ETIQUETA" "$RAIZ/microservicios"
# Reintentos: en redes inestables el registro corta conexiones a mitad de la subida
subir() { for n in 1 2 3 4 5; do docker push -q "$1" && return 0; echo "  reintento $n de la subida…"; sleep 5; done; return 1; }
subir "$SERVIDOR/descubre-ms:$ETIQUETA"
IMAGEN="$SERVIDOR/descubre-ms:$ETIQUETA"

ENTORNO=descubre-env
# WorkloadProfiles (perfil Consumption): el modo "Express" que Azure elige por defecto en algunas regiones
# no admite jobs ni puertos TCP adicionales (la copia de datos y el gRPC entre servicios los necesitan).
paso "Entorno de Container Apps $ENTORNO"
az containerapp env show -g "$AZ_GRUPO" -n "$ENTORNO" -o none 2>/dev/null || az containerapp env create -g "$AZ_GRUPO" -n "$ENTORNO" -l "$AZ_REGION" --environment-mode WorkloadProfiles -o none
DOMINIO="$(az containerapp env show -g "$AZ_GRUPO" -n "$ENTORNO" --query properties.defaultDomain -o tsv)"
GATEWAY_URL="https://descubre-gateway.$DOMINIO"

SERVICIOS=(location catalog review pricing inventory coupon order booking payment refund invoicing identity)
# Servicios gRPC del script del equipo y su puerto (expuesto solo dentro del entorno)
declare -A GRPC_PUERTO=([pricing]=50044 [inventory]=50045 [order]=50047 [booking]=50048)

# La copia corre DENTRO de Azure (job de una sola ejecución con la misma imagen): muchas redes, como la
# de la universidad, bloquean los puertos 5432/6543 hacia Supabase desde la laptop. Los servicios
# transaccionales solo se copian la primera vez (su base vacía): un redespliegue no pisa sus datos.
# Solo en el primer despliegue (o con COPIAR_DATOS=true): después cada servicio aplica sus migraciones al
# arrancar y sus datos ya son suyos. Además, con las apps encendidas el pooler gratuito (~15 conexiones)
# queda casi lleno y la copia no tendría lugar.
COPIAR="${COPIAR_DATOS:-}"
# Apps ya creadas. Un corte de red no debe confundirse con "no existe": si la consulta falla, se detiene
APPS="$(az containerapp list -g "$AZ_GRUPO" --query "[].name" -o tsv)" || { echo "  ✘ no se pudo consultar Azure; reintenta"; exit 1; }
existe() { grep -qx "$1" <<<"$APPS"; }
if [ -z "$COPIAR" ]; then existe descubre-gateway && COPIAR=false || COPIAR=true; fi
if [ "$COPIAR" = true ]; then
paso "Datos de la tienda → schemas de los 11 microservicios (mismos IDs)"
JOB=descubre-migrar
JOB_VARS=(DB_SSL=true TIENDA_DATABASE_URL=secretref:database-url)
for s in "${SERVICIOS[@]}"; do JOB_VARS+=("${s^^}_DATABASE_URL=secretref:database-url" "${s^^}_DB_SCHEMA=ms_$s"); done
if az containerapp job show -g "$AZ_GRUPO" -n "$JOB" -o none 2>/dev/null; then
  az containerapp job secret set -g "$AZ_GRUPO" -n "$JOB" --secrets database-url="$MS_DATABASE_URL" -o none
  az containerapp job update -g "$AZ_GRUPO" -n "$JOB" --image "$IMAGEN" --set-env-vars "${JOB_VARS[@]}" -o none
else
  az containerapp job create -g "$AZ_GRUPO" -n "$JOB" --environment "$ENTORNO" --trigger-type Manual \
    --replica-timeout 900 --replica-retry-limit 0 --parallelism 1 --replica-completion-count 1 \
    --image "$IMAGEN" --registry-server "$SERVIDOR" --registry-username "$ACR_USUARIO" --registry-password "$ACR_CLAVE" \
    --cpu 0.25 --memory 0.5Gi --secrets database-url="$MS_DATABASE_URL" --env-vars "${JOB_VARS[@]}" \
    --command node --args scripts/migrar-desde-tienda.js -o none
fi
EJEC="$(az containerapp job start -g "$AZ_GRUPO" -n "$JOB" --query name -o tsv)"
ESTADO=Running
for i in $(seq 1 90); do
  ESTADO="$(az containerapp job execution show -g "$AZ_GRUPO" -n "$JOB" --job-execution-name "$EJEC" --query properties.status -o tsv 2>/dev/null || echo Running)"
  case "$ESTADO" in Succeeded) echo "  ✔ datos copiados"; break ;; Failed|Stopped|Degraded) echo "  ✘ la copia terminó en $ESTADO: revisa los registros del job $JOB en el portal"; exit 1 ;; esac
  sleep 10
done
[ "$ESTADO" = Succeeded ] || { echo "  ✘ la copia no terminó a tiempo"; exit 1; }
else
  paso "Copia de datos: se omite (ya desplegado; COPIAR_DATOS=true para forzarla)"
fi

# Reintenta un comando de Azure: con redes inestables la CLI corta a mitad (las actualizaciones son idempotentes)
reintentar() { for n in 1 2 3 4 5; do "$@" && return 0; echo "  reintento $n…"; sleep 15; done; return 1; }

# app NOMBRE INGRESO(external|internal) CPU MEMORIA -- secretos... -- variables...
app() {
  local nombre=$1 ingreso=$2 cpu=$3 mem=$4; shift 4
  local secretos=() vars=()
  [ "$1" = "--" ] && shift
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do secretos+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  vars=("$@")
  echo "  · $nombre"
  if existe "$nombre"; then
    reintentar az containerapp secret set -g "$AZ_GRUPO" -n "$nombre" --secrets "${secretos[@]}" -o none
    reintentar az containerapp update -g "$AZ_GRUPO" -n "$nombre" --image "$IMAGEN" --cpu "$cpu" --memory "$mem" \
      --min-replicas 1 --max-replicas 1 --set-env-vars "${vars[@]}" -o none
  else
    reintentar az containerapp create -g "$AZ_GRUPO" -n "$nombre" --environment "$ENTORNO" --image "$IMAGEN" \
      --registry-server "$SERVIDOR" --registry-username "$ACR_USUARIO" --registry-password "$ACR_CLAVE" \
      --ingress "$ingreso" --target-port 8080 --cpu "$cpu" --memory "$mem" \
      --min-replicas 1 --max-replicas 1 --secrets "${secretos[@]}" --env-vars "${vars[@]}" -o none
  fi
}

# Puerto gRPC adicional (TCP, solo interno): los demás servicios lo llaman como descubre-<s>:<puerto>
puerto_grpc() {
  local nombre=$1 puerto=$2 id
  id="$(reintentar az containerapp show -g "$AZ_GRUPO" -n "$nombre" --query id -o tsv)"
  reintentar az rest --method patch --url "https://management.azure.com${id}?api-version=2024-03-01" --body "{
    \"properties\": { \"configuration\": { \"ingress\": {
      \"external\": false, \"targetPort\": 8080, \"transport\": \"auto\",
      \"additionalPortMappings\": [ { \"external\": false, \"targetPort\": $puerto, \"exposedPort\": $puerto } ] } } } }" -o none
}

# Retira la tienda de despliegues anteriores (ya no participa: todo lo atienden los microservicios)
if existe descubre-tienda; then
  echo "  · descubre-tienda: se retira"
  az containerapp delete -g "$AZ_GRUPO" -n descubre-tienda --yes -o none
fi

paso "Aplicaciones"
# Stock y aviso de check-in a Booking: REST por defecto; con BOOKING_GRPC_URL el stock va por gRPC
BOOKING_API_URL="${BOOKING_API_URL:-https://booking-core-api.azurewebsites.net}"
STOCK=(BOOKING_STOCK_ENABLED=true BOOKING_SERVICE_ID="${BOOKING_SERVICE_ID:-NODE_ATR_DILAN}")
[ -n "${BOOKING_GRPC_URL:-}" ] && STOCK+=(BOOKING_GRPC_URL="$BOOKING_GRPC_URL")
MS_SECRETOS=(database-url="$MS_DATABASE_URL" jwt-secret="$JWT_SECRET" booking-key="$BOOKING_API_KEY" servicios-token="$SERVICIOS_TOKEN")
URLS=()
for s in "${SERVICIOS[@]}"; do URLS+=("${s^^}_URL=http://descubre-$s"); done
for s in "${!GRPC_PUERTO[@]}"; do URLS+=("${s^^}_GRPC_URL=descubre-$s:${GRPC_PUERTO[$s]}"); done
MS_VARS=(NODE_ENV=production PORT=8080 DB_SSL=true DATABASE_URL=secretref:database-url JWT_SECRET=secretref:jwt-secret
  BOOKING_API_KEY=secretref:booking-key SERVICIOS_TOKEN=secretref:servicios-token PUBLIC_URL="$GATEWAY_URL" BOOKING_API_URL="$BOOKING_API_URL"
  FOTOS_BASE_URL="${FOTOS_BASE_URL:-https://sistemaatracciones-backend.vercel.app}" "${URLS[@]}")
# El Session pooler de Supabase (plan gratuito) admite ~15 conexiones: 1 por servicio, 2 en los más usados
declare -A POOL=([catalog]=2 [inventory]=2 [booking]=2)
declare -A EVENTOS=([review]=http://descubre-catalog/api/v1/internal/eventos [pricing]=http://descubre-catalog/api/v1/internal/eventos [inventory]=http://descubre-booking/api/v1/internal/eventos)
for s in "${SERVICIOS[@]}"; do
  extra=(SERVICIO="ms-$s" DB_SCHEMA="ms_$s" DB_POOL_MAX="${POOL[$s]:-1}")
  [ -n "${GRPC_PUERTO[$s]:-}" ] && extra+=(GRPC_PORT="${GRPC_PUERTO[$s]}")
  [ -n "${EVENTOS[$s]:-}" ] && extra+=(EVENTOS_DESTINOS="${EVENTOS[$s]}")
  [ "$s" = inventory ] && extra+=("${STOCK[@]}")
  # ms-identity se usa poco: suelta su conexión al quedar inactivo y el pooler se queda con 14 fijas
  [ "$s" = identity ] && extra+=(DB_IDLE_MS=30000)
  app "descubre-$s" internal 0.25 0.5Gi -- "${MS_SECRETOS[@]}" -- "${extra[@]}" "${MS_VARS[@]}"
  [ -n "${GRPC_PUERTO[$s]:-}" ] && puerto_grpc "descubre-$s" "${GRPC_PUERTO[$s]}"
done
GW_URLS=(CATALOG_URL=http://descubre-catalog)
for s in "${SERVICIOS[@]}"; do [ "$s" = catalog ] || GW_URLS+=("${s^^}_URL=http://descubre-$s"); done
GW_URLS+=(BFF_URL=http://descubre-bff)
# BFF de la web y el panel: sin base propia, no usa conexiones del pooler
app descubre-bff internal 0.25 0.5Gi -- jwt-secret="$JWT_SECRET" -- SERVICIO=bff-web NODE_ENV=production PORT=8080 JWT_SECRET=secretref:jwt-secret \
  FOTOS_BASE_URL="${FOTOS_BASE_URL:-https://sistemaatracciones-backend.vercel.app}" FRONTEND_URL="${FRONTEND_URL:-}" "${URLS[@]}"
app descubre-gateway external 0.25 0.5Gi -- servicios-token="$SERVICIOS_TOKEN" -- \
  SERVICIO=gateway NODE_ENV=production PORT=8080 GATEWAY_TIMEOUT_MS=8000 NODE_CODE="${BOOKING_SERVICE_ID:-NODE_ATR_DILAN}" "${GW_URLS[@]}"

paso "Esperando al gateway y a los 11 servicios"
for i in $(seq 1 60); do
  [ "$(curl -s "$GATEWAY_URL/api/v3/health" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).status)}catch{console.log('')}})")" = UP ] && break
  sleep 5
done
paso "Prueba del contrato v3 en la nube (compra real por la saga)"
GATEWAY_URL="$GATEWAY_URL" BOOKING_API_KEY="$BOOKING_API_KEY" node "$RAIZ/microservicios/scripts/prueba-humo.js" || true

echo
echo "════════════════════════════════════════════════════════════"
echo " URL base para Booking:  $GATEWAY_URL/api/v3"
echo "════════════════════════════════════════════════════════════"

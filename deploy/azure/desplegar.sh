#!/usr/bin/env bash
# Despliega en Azure Container Apps la tienda, ms-location, ms-catalog, ms-review y el gateway.
# Las bases quedan en Supabase: la tienda en `public` y cada microservicio en su schema.
#
#   1) cp deploy/azure/.env.example deploy/azure/.env   (y llénalo)
#   2) az login
#   3) bash deploy/azure/desplegar.sh                    (Git Bash, Docker Desktop encendido)
#
# Se puede repetir: la segunda vez solo sube imágenes nuevas, vuelve a copiar el catálogo y actualiza la
# configuración. No necesita conexión directa a Supabase desde tu red (todo corre en Azure).
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
for v in AZ_GRUPO AZ_REGION AZ_REGISTRO DATABASE_URL JWT_SECRET BOOKING_API_KEY FRONTEND_URL; do [ -n "${!v:-}" ] || faltan+=("$v"); done
[ ${#faltan[@]} -eq 0 ] || { echo "Completa en deploy/azure/.env: ${faltan[*]}"; exit 1; }
[ ${#BOOKING_API_KEY} -ge 24 ] || { echo "BOOKING_API_KEY debe tener 24+ caracteres"; exit 1; }
[ ${#JWT_SECRET} -ge 32 ] || { echo "JWT_SECRET debe tener 32+ caracteres"; exit 1; }

# Token entre microservicios: se genera una vez y queda guardado en deploy/azure/.env
if [ -z "${SERVICIOS_TOKEN:-}" ]; then
  SERVICIOS_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
  printf '\n# Generado por desplegar.sh (token entre microservicios)\nSERVICIOS_TOKEN=%s\n' "$SERVICIOS_TOKEN" >> "$CONF"
fi

# De la URL del pooler de Supabase (cualquiera de los dos puertos) salen las dos conexiones:
#  - tienda: Transaction pooler (6543), como en Vercel;
#  - microservicios: Session pooler (5432), para que cada conexión conserve su schema.
pooler() { node -e "const u=new URL(process.argv[1]);if(!/pooler\.supabase\.com$/.test(u.hostname)){console.error('DATABASE_URL debe ser la del pooler de Supabase (…pooler.supabase.com): Azure no llega a la conexión directa (solo IPv6)');process.exit(1)}u.port=process.argv[2];u.searchParams.delete('pgbouncer');u.searchParams.delete('schema');console.log(u.toString())" "$DATABASE_URL" "$1"; }
TIENDA_DATABASE_URL="$(pooler 6543)"
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
paso "Imágenes ($ETIQUETA)"
# SIN_TIENDA=true (por defecto): solo los microservicios de Dilan; la tienda no se publica en Azure
SIN_TIENDA="${SIN_TIENDA:-true}"
[ "$SIN_TIENDA" = true ] || docker build -t "$SERVIDOR/descubre-tienda:$ETIQUETA" "$RAIZ/backend"
docker build -t "$SERVIDOR/descubre-ms:$ETIQUETA" "$RAIZ/microservicios"
# Reintentos: en redes inestables el registro corta conexiones a mitad de la subida
subir() { for n in 1 2 3 4 5; do docker push -q "$1" && return 0; echo "  reintento $n de la subida…"; sleep 5; done; return 1; }
[ "$SIN_TIENDA" = true ] || subir "$SERVIDOR/descubre-tienda:$ETIQUETA"
subir "$SERVIDOR/descubre-ms:$ETIQUETA"

ENTORNO=descubre-env
# WorkloadProfiles (perfil Consumption): el modo "Express" que Azure elige por defecto en algunas regiones
# no admite jobs (la copia de datos corre como job).
paso "Entorno de Container Apps $ENTORNO"
az containerapp env show -g "$AZ_GRUPO" -n "$ENTORNO" -o none 2>/dev/null || az containerapp env create -g "$AZ_GRUPO" -n "$ENTORNO" -l "$AZ_REGION" --environment-mode WorkloadProfiles -o none
DOMINIO="$(az containerapp env show -g "$AZ_GRUPO" -n "$ENTORNO" --query properties.defaultDomain -o tsv)"
GATEWAY_URL="https://descubre-gateway.$DOMINIO"

# La copia corre DENTRO de Azure (job de una sola ejecución con la misma imagen): muchas redes, como la
# de la universidad, bloquean los puertos 5432/6543 hacia Supabase desde la laptop.
paso "Datos de la tienda → schemas de los microservicios (mismos IDs)"
JOB=descubre-migrar
JOB_VARS=(DB_SSL=true TIENDA_DATABASE_URL=secretref:database-url LOCATION_DATABASE_URL=secretref:database-url
  CATALOG_DATABASE_URL=secretref:database-url REVIEW_DATABASE_URL=secretref:database-url
  LOCATION_DB_SCHEMA=ms_location CATALOG_DB_SCHEMA=ms_catalog REVIEW_DB_SCHEMA=ms_review)
if az containerapp job show -g "$AZ_GRUPO" -n "$JOB" -o none 2>/dev/null; then
  az containerapp job secret set -g "$AZ_GRUPO" -n "$JOB" --secrets database-url="$MS_DATABASE_URL" -o none
  az containerapp job update -g "$AZ_GRUPO" -n "$JOB" --image "$SERVIDOR/descubre-ms:$ETIQUETA" --set-env-vars "${JOB_VARS[@]}" -o none
else
  az containerapp job create -g "$AZ_GRUPO" -n "$JOB" --environment "$ENTORNO" --trigger-type Manual     --replica-timeout 900 --replica-retry-limit 0 --parallelism 1 --replica-completion-count 1     --image "$SERVIDOR/descubre-ms:$ETIQUETA" --registry-server "$SERVIDOR" --registry-username "$ACR_USUARIO" --registry-password "$ACR_CLAVE"     --cpu 0.25 --memory 0.5Gi --secrets database-url="$MS_DATABASE_URL" --env-vars "${JOB_VARS[@]}"     --command node --args scripts/migrar-desde-tienda.js -o none
fi
EJEC="$(az containerapp job start -g "$AZ_GRUPO" -n "$JOB" --query name -o tsv)"
for i in $(seq 1 90); do
  ESTADO="$(az containerapp job execution show -g "$AZ_GRUPO" -n "$JOB" --job-execution-name "$EJEC" --query properties.status -o tsv 2>/dev/null || echo Running)"
  case "$ESTADO" in Succeeded) echo "  ✔ datos copiados"; break ;; Failed|Stopped|Degraded) echo "  ✘ la copia terminó en $ESTADO: revisa los registros del job $JOB en el portal"; exit 1 ;; esac
  sleep 10
done
[ "$ESTADO" = Succeeded ] || { echo "  ✘ la copia no terminó a tiempo"; exit 1; }

# app NOMBRE IMAGEN INGRESO(external|internal) PUERTO CPU MEMORIA -- secretos... -- variables...
app() {
  local nombre=$1 imagen=$2 ingreso=$3 puerto=$4 cpu=$5 mem=$6; shift 6
  local secretos=() vars=()
  [ "$1" = "--" ] && shift
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do secretos+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  vars=("$@")
  echo "  · $nombre"
  if az containerapp show -g "$AZ_GRUPO" -n "$nombre" -o none 2>/dev/null; then
    az containerapp secret set -g "$AZ_GRUPO" -n "$nombre" --secrets "${secretos[@]}" -o none
    az containerapp update -g "$AZ_GRUPO" -n "$nombre" --image "$imagen" --cpu "$cpu" --memory "$mem" \
      --min-replicas 1 --max-replicas 2 --set-env-vars "${vars[@]}" -o none
  else
    az containerapp create -g "$AZ_GRUPO" -n "$nombre" --environment "$ENTORNO" --image "$imagen" \
      --registry-server "$SERVIDOR" --registry-username "$ACR_USUARIO" --registry-password "$ACR_CLAVE" \
      --ingress "$ingreso" --target-port "$puerto" --cpu "$cpu" --memory "$mem" \
      --min-replicas 1 --max-replicas 2 --secrets "${secretos[@]}" --env-vars "${vars[@]}" -o none
  fi
}

GRPC=()
if [ -n "${BOOKING_GRPC_URL:-}" ]; then GRPC=(BOOKING_GRPC_URL="$BOOKING_GRPC_URL" BOOKING_GRPC_ENABLED=true); else GRPC=(BOOKING_GRPC_ENABLED=false); fi
SB_SECRETO=(); SB_VARS=()
if [ -n "${SUPABASE_URL:-}" ]; then
  SB_SECRETO=(supabase-key="$SUPABASE_SERVICE_ROLE_KEY")
  SB_VARS=(SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-key SUPABASE_BUCKET="${SUPABASE_BUCKET:-uploads}")
fi

paso "Aplicaciones"
if [ "$SIN_TIENDA" = true ]; then
  if az containerapp show -g "$AZ_GRUPO" -n descubre-tienda -o none 2>/dev/null; then
    echo "  · descubre-tienda: se retira (solo se publican ms_location, ms_catalog y ms_review)"
    az containerapp delete -g "$AZ_GRUPO" -n descubre-tienda --yes -o none
  fi
else
app descubre-tienda "$SERVIDOR/descubre-tienda:$ETIQUETA" internal 3000 0.5 1Gi -- \
  database-url="$TIENDA_DATABASE_URL" jwt-secret="$JWT_SECRET" booking-key="$BOOKING_API_KEY" "${SB_SECRETO[@]}" -- \
  NODE_ENV=production SEED_ON_START=false DB_SYNC=false DB_MIGRATIONS_RUN=true DB_SSL=true DB_POOL_MAX=5 TRUST_PROXY=1 \
  DATABASE_URL=secretref:database-url JWT_SECRET=secretref:jwt-secret BOOKING_API_KEY=secretref:booking-key \
  BOOKING_SERVICE_ID="${BOOKING_SERVICE_ID:-NODE_ATR_DILAN}" PUBLIC_URL="$GATEWAY_URL" FRONTEND_URL="$FRONTEND_URL" \
  "${SB_VARS[@]}" "${GRPC[@]}"
fi
# Fotos del catálogo: con la tienda, por el gateway; sin ella, desde el backend de Vercel (mismas rutas /api/v1/media/…)
FOTOS="${FOTOS_BASE_URL:-$([ "$SIN_TIENDA" = true ] && echo https://sistemaatracciones-backend.vercel.app || echo "$GATEWAY_URL")}"

MS_SECRETOS=(database-url="$MS_DATABASE_URL" jwt-secret="$JWT_SECRET" booking-key="$BOOKING_API_KEY" servicios-token="$SERVICIOS_TOKEN")
MS_VARS=(NODE_ENV=production PORT=8080 DB_SSL=true DB_POOL_MAX=3 DATABASE_URL=secretref:database-url JWT_SECRET=secretref:jwt-secret
  BOOKING_API_KEY=secretref:booking-key SERVICIOS_TOKEN=secretref:servicios-token
  LOCATION_URL=http://descubre-location CATALOG_URL=http://descubre-catalog TIENDA_URL=http://descubre-tienda
  EVENTOS_DESTINOS=http://descubre-catalog/api/v1/internal/eventos FOTOS_BASE_URL="$FOTOS")
for s in location catalog review; do
  app "descubre-$s" "$SERVIDOR/descubre-ms:$ETIQUETA" internal 8080 0.25 0.5Gi -- "${MS_SECRETOS[@]}" -- \
    SERVICIO="ms-$s" DB_SCHEMA="ms_$s" "${MS_VARS[@]}"
done
app descubre-gateway "$SERVIDOR/descubre-ms:$ETIQUETA" external 8080 0.25 0.5Gi -- servicios-token="$SERVICIOS_TOKEN" -- \
  SERVICIO=gateway NODE_ENV=production PORT=8080 GATEWAY_TIMEOUT_MS=8000 NODE_CODE="${BOOKING_SERVICE_ID:-NODE_ATR_DILAN}" \
  CATALOG_URL=http://descubre-catalog LOCATION_URL=http://descubre-location REVIEW_URL=http://descubre-review TIENDA_URL=http://descubre-tienda SIN_TIENDA="$SIN_TIENDA"

paso "Esperando al gateway"
for i in $(seq 1 60); do
  curl -fs "$GATEWAY_URL/api/v3/atracciones/health" -H "X-API-Key: $BOOKING_API_KEY" >/dev/null 2>&1 && break
  sleep 5
done
paso "Prueba del contrato v3 en la nube"
SIN_TIENDA="$SIN_TIENDA" GATEWAY_URL="$GATEWAY_URL" BOOKING_API_KEY="$BOOKING_API_KEY" node "$RAIZ/microservicios/scripts/prueba-humo.js" || true

echo
echo "════════════════════════════════════════════════════════════"
echo " URL base para Booking:  $GATEWAY_URL/api/v3"
echo "════════════════════════════════════════════════════════════"

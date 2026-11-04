# Una sola imagen con los 11 microservicios y el gateway; SERVICIO elige cuál arranca.
#   docker build -t descubre-ms microservicios
#   docker run -e SERVICIO=ms-booking -e DATABASE_URL=… descubre-ms
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY ms-location/package.json ms-location/
COPY ms-catalog/package.json ms-catalog/
COPY ms-review/package.json ms-review/
COPY ms-pricing/package.json ms-pricing/
COPY ms-inventory/package.json ms-inventory/
COPY ms-coupon/package.json ms-coupon/
COPY ms-order/package.json ms-order/
COPY ms-booking/package.json ms-booking/
COPY ms-payment/package.json ms-payment/
COPY ms-refund/package.json ms-refund/
COPY ms-invoicing/package.json ms-invoicing/
COPY gateway/package.json gateway/
RUN npm ci
COPY . .
# Compila todo y deja solo lo que se ejecuta: dist, sql (migraciones), contract (WSDL de facturación) y proto
RUN npm run build && npm prune --omit=dev \
 && rm -rf */src */test scripts/*.sh

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 SERVICIO=gateway
COPY --from=build /app /app
USER node
CMD ["sh", "-c", "exec node ${SERVICIO}/dist/main.js"]

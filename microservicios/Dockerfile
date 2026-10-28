# Una sola imagen con ms-location, ms-catalog, ms-review y el gateway; SERVICIO elige cuál arranca.
#   docker build -t descubre-ms microservicios
#   docker run -e SERVICIO=ms-catalog -e DATABASE_URL=… descubre-ms
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY ms-location/package.json ms-location/
COPY ms-catalog/package.json ms-catalog/
COPY ms-review/package.json ms-review/
COPY gateway/package.json gateway/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 SERVICIO=gateway
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/ms-location/package.json ./ms-location/
COPY --from=build /app/ms-location/dist ./ms-location/dist
COPY --from=build /app/ms-location/sql ./ms-location/sql
COPY --from=build /app/ms-catalog/package.json ./ms-catalog/
COPY --from=build /app/ms-catalog/dist ./ms-catalog/dist
COPY --from=build /app/ms-catalog/sql ./ms-catalog/sql
COPY --from=build /app/ms-review/package.json ./ms-review/
COPY --from=build /app/ms-review/dist ./ms-review/dist
COPY --from=build /app/ms-review/sql ./ms-review/sql
COPY --from=build /app/gateway/package.json ./gateway/
COPY --from=build /app/gateway/dist ./gateway/dist
COPY --from=build /app/scripts ./scripts
USER node
CMD ["sh", "-c", "exec node ${SERVICIO}/dist/main.js"]

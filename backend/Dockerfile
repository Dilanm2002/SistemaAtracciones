# Tienda (API de Atracciones) para Azure Container Apps. En Vercel no se usa: allí corre api/index.js.
#   docker build -t descubre-tienda backend
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/main"]

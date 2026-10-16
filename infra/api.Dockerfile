# Proceso HTTP. Construccion en varias etapas: la imagen final no lleva ni el
# compilador de TypeScript ni las dependencias de desarrollo.

FROM node:22.15.0-alpine AS node-base
RUN npm install --global npm@11.6.0

FROM node-base AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY backend/prisma/ backend/prisma/
COPY shared/contracts/package.json shared/contracts/
COPY shared/domain-core/package.json shared/domain-core/
COPY shared/generation-ir/package.json shared/generation-ir/
COPY shared/generator-backend/package.json shared/generator-backend/
COPY shared/xmi/package.json shared/xmi/
COPY shared/ai/package.json shared/ai/
COPY shared/yjs-adapter/package.json shared/yjs-adapter/
COPY fixtures/package.json fixtures/
COPY backend/api/package.json backend/api/
COPY backend/collab/package.json backend/collab/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund

# Imagen de un solo uso para `prisma migrate deploy`. Conserva el CLI, que es
# una herramienta de construccion/operacion y no una dependencia del proceso
# HTTP expuesto.
FROM deps AS migrate

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY config/tsconfig.base.json config/
COPY shared/ shared/
COPY backend/api/ backend/api/
RUN npx tsc --build backend/api

FROM node-base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Los package.json de todos los workspaces se toman de la etapa de dependencias,
# que ya los reunio. Volver a listarlos aqui a mano significaba que cada
# dependencia nueva entre paquetes compartidos rompia la imagen en ejecucion, y
# el fallo solo aparecia al arrancar el contenedor.
COPY package.json package-lock.json ./
COPY --from=deps /app/shared/ shared/
COPY --from=deps /app/fixtures/ fixtures/
COPY --from=deps /app/backend/ backend/
COPY --from=deps /app/frontend/ frontend/
RUN npm ci --no-audit --no-fund --omit=dev --omit=optional --ignore-scripts --workspace @uml/api --include-workspace-root

# `prisma generate` ya corrio en `deps`. El proceso solo necesita el cliente
# resultante; ni el CLI ni la configuracion de migraciones.
COPY --from=deps /app/node_modules/.prisma/ node_modules/.prisma/

# Y lo compilado, tambien completo: el grafo de dependencias entre paquetes
# compartidos lo decide el codigo, no este archivo.
COPY --from=build /app/shared/ shared/
COPY --from=build /app/backend/api/dist backend/api/dist

# Las plantillas de generacion. **No son codigo compilado**: son archivos que el
# generador lee en ejecucion, resueltos relativos a su propio `dist`, y por eso
# no llegaban con `tsc --build`.
#
# Sin ellas la imagen arranca sana, responde a todo y solo falla al generar, con
# un 500 y un ENOENT: el banco de regresion no lo ve porque corre fuera del
# contenedor, y la unica forma de detectarlo era generar desde el navegador
# contra la plataforma levantada.
COPY templates/ templates/

USER node
EXPOSE 3001
CMD ["node", "backend/api/dist/server.js"]

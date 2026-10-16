# Proceso WebSocket. Misma estrategia que el proceso HTTP.

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

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY config/tsconfig.base.json config/
COPY shared/ shared/
COPY backend/collab/ backend/collab/
RUN npx tsc --build backend/collab

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
RUN npm ci --no-audit --no-fund --omit=dev --omit=optional --ignore-scripts --workspace @uml/collab --include-workspace-root

# El cliente generado si es runtime; el CLI de Prisma no.
COPY --from=deps /app/node_modules/.prisma/ node_modules/.prisma/

# Y lo compilado, tambien completo: el grafo de dependencias entre paquetes
# compartidos lo decide el codigo, no este archivo.
COPY --from=build /app/shared/ shared/
COPY --from=build /app/backend/collab/dist backend/collab/dist

USER node
EXPOSE 3002
CMD ["node", "backend/collab/dist/server.js"]

# Interfaz React. Se compila a estatico y la sirve nginx; el enrutado del lado
# del cliente cae siempre en index.html.

FROM node:22.15.0-alpine AS build
RUN npm install --global npm@11.6.0
WORKDIR /app
# El esquema entra antes de `npm ci` porque el postinstall de la raiz genera el
# cliente de Prisma. La interfaz no lo usa, pero la instalacion del monorepo si.
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
COPY tsconfig.json ./
COPY config/tsconfig.base.json config/
COPY shared/ shared/
COPY frontend/ frontend/
RUN npm run build --workspace @uml/web

FROM nginx:1.27-alpine AS runtime
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

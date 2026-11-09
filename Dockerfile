# syntax=docker/dockerfile:1
# Giai đoạn 14: image backend production (Express + Socket.IO). Cùng image chạy migration: `npm run migrate:prod`.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.migrations.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm run build:migrations \
    # i18next đọc file JSON lúc chạy (dist/config/../locales)
    && cp -r src/locales dist/locales \
    && npm prune --omit=dev

FROM node:24-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    LOG_TO_FILE=false \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
RUN apk add --no-cache tini wget
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/api/health/ready > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "-r", "./scripts/register-paths.js", "dist/server.js"]

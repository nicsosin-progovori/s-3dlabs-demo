# syntax=docker/dockerfile:1
# Самодостаточный образ. Контекст сборки — корень репозитория; приложение в app/.
# Стадии: deps (полные зависимости + исходники; тесты) → builder (dist) →
#         runtime (Playwright base + прод-зависимости + dist) ; dev (Playwright base +
#         полные зависимости, исходники монтируются bind-mount'ом).
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble
ARG NPM_VERSION=12.2.1

FROM node:22-bookworm AS deps
ARG NPM_VERSION
WORKDIR /app
RUN npm i -g "npm@${NPM_VERSION}"
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY app/ ./

FROM deps AS builder
RUN npm run build

FROM ${PLAYWRIGHT_IMAGE} AS runtime
ARG NPM_VERSION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5180 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 XDG_CACHE_HOME=/tmp/.cache
WORKDIR /app
RUN npm i -g "npm@${NPM_VERSION}"
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir -p .cache/uploads/logos && chown -R pwuser:pwuser /app
COPY --from=builder /app/dist ./dist
COPY app/server ./server
COPY app/shared ./shared
COPY app/config ./config
COPY app/models ./models
USER pwuser
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5180)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/start.mjs","--production"]

# --- dev: полная среда; исходники приходят bind-mount'ом ---
FROM ${PLAYWRIGHT_IMAGE} AS dev
ARG NPM_VERSION
WORKDIR /app
ENV HOST=0.0.0.0 PORT=5180
RUN npm i -g "npm@${NPM_VERSION}"
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
EXPOSE 5180
CMD ["npm","run","dev:bottle"]

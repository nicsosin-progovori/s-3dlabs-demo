# syntax=docker/dockerfile:1
# Самодостаточный образ. Контекст сборки — корень репозитория; приложение в app/.
# Стадии: deps (полные зависимости + исходники; тесты) → builder (dist) →
#         runtime (Playwright base + прод-зависимости + dist) ; dev (Playwright base +
#         полные зависимости, исходники монтируются bind-mount'ом для синхронизации).
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble

FROM node:22-bookworm AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY app/ ./

FROM deps AS builder
RUN npm run build

FROM ${PLAYWRIGHT_IMAGE} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5180 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 XDG_CACHE_HOME=/tmp/.cache
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir -p .cache/uploads/logos && chown -R pwuser:pwuser /app
# renderer несёт собственную копию dist (решение владельца: self-contained).
# TODO(ревью): вариант, когда renderer тянет render.html+ассеты из web по сети.
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

# --- dev: полная среда для dev-контейнера; исходники приходят bind-mount'ом ---
FROM ${PLAYWRIGHT_IMAGE} AS dev
WORKDIR /app
ENV HOST=0.0.0.0 PORT=5180
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
EXPOSE 5180
CMD ["npm","run","dev:bottle"]

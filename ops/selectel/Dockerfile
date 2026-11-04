# DEPRECATED (Фаза 2): заменён на ops/docker/. Оставлен как справка по таргету Selectel.
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble
FROM ${PLAYWRIGHT_IMAGE}
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PORT=5180 HOST=0.0.0.0 \
    NODE_OPTIONS=--max-old-space-size=160 XDG_CACHE_HOME=/tmp/.cache
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir -p .cache/uploads/logos \
    && chown -R pwuser:pwuser .cache
COPY dist ./dist
COPY server ./server
COPY shared ./shared
COPY config ./config
COPY models ./models
USER pwuser
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5180/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/start.mjs","--production"]

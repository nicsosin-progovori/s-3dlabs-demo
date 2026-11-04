# DevOps-оснастка (ops/)

Единый дом для всего, что касается сборки/запуска/эксплуатации. Код приложения
сюда не лезет. Статус: **Фаза 1** (харнесс на коде «как есть», без переезда в `app/`).

## Структура
- `docker/Dockerfile` — self-contained multi-stage образ (builder собирает `dist`,
  runtime на базе Playwright несёт `dist` + server/shared/config/models).
- `docker/docker-compose.yml` — сервисы `web` (:5180) и `renderer` (:5181) из одного
  образа; опциональный `proxy` (профиль `edge`).
- `docker/nginx.conf` — локальный обратный прокси: `/api/render` → renderer, остальное → web.
- `docker/.env.example` — пример переменных (скопировать в `docker/.env`).
- `bin/` — пульт: `up`, `start` (= `up -d`), `stop`, `build`, `sh [web|renderer]`, `health`, `dev [front|docker]`, `logs [svc]`, `test` (юнит-тесты в контейнере, стадия `deps`).
- `selectel/` — оверлей конкретного таргета (systemd/nginx/certbot), поверх общего образа.

## Как поднять
Прод-подобно (два сервиса):
```
ops/bin/up            # docker compose up --build; web :5180, renderer :5181
ops/bin/up -d         # в фоне
ops/bin/logs renderer
ops/bin/sh web        # зайти внутрь контейнера
```
С локальным прокси (один вход :8080, роутинг web/renderer):
```
docker compose -f ops/docker/docker-compose.yml --profile edge up --build
```
Разработка — на хосте (прокси не нужен):
```
ops/bin/dev          # сервер + API + рендер (:5180); сам сделает npm ci при первом запуске
ops/bin/dev front    # только фронт с HMR (:5173)
ops/bin/dev docker   # dev В КОНТЕЙНЕРЕ с синхронизацией в локальный проект

Dev в контейнере (`ops/bin/dev docker` = `docker compose --profile dev up dev`):
сборка идёт в контейнере (среда как в проде), а `app/` монтируется bind-mount'ом —
правки на хосте подхватываются (HMR), а собранное (`app/dist`) появляется на хосте.
`node_modules` и кеши живут в volume (НЕ на хосте: нативные бинарники Linux
несовместимы с Mac) и в git не попадают.
```

## Переменные
`PORT`, `HOST`, `BOTTLE_ALLOWED_ORIGINS` (CORS allowlist), `*_NODE_OPTIONS`
(в т.ч. лимит памяти). Лимиты ресурсов задаём в compose/оркестраторе, не в образе.

## Данные
- Мутабельное (логотипы, в будущем результаты рендера) — volume `uploads`
  (`/app/.cache/uploads`), in-process очередь на старте (решение владельца).
- Иммутабельные ассеты (GLB/skins/textures, sha256) — внутри образа/раздаются web.

## TODO (осознанные упрощения Фазы 1)
- **web без браузера**: сейчас web и renderer — один тяжёлый образ (с Chromium).
  Позже — отдельный лёгкий web-образ без браузера.
- **Разделение рендера по коду**: честный split требует код-шва в `server/` —
  web проксирует `/api/render` в renderer (сейчас каждый сервис умеет рендерить сам;
  в прод-роутинге render уводится на renderer прокси-правилом). Фаза 2.
- **Ассеты для renderer**: сейчас своя копия `dist` (self-contained). _Нужно ревью_
  варианта «renderer тянет render.html+ассеты из web по сети».
- **Асинхронная галерея / polling**: Фаза 3. Сейчас только синхронный `/api/render`;
  подписку/очередь-галерею не строим — см. `docs/architecture/rendering-async.md`.
- **Переезд в `app/`**: Фаза 2 (см. `docs/architecture/migration-plan.md`).

## Рабочий цикл (демон)
Демон = web + renderer в фоне (on-demand): работают, пока не остановишь `ops/bin/stop`;
сами после перезапуска Docker/ПК НЕ поднимаются. Нужно авто-поднятие — раскомментируй
`restart: unless-stopped` в `ops/docker/docker-compose.yml`.
```
ops/bin/start          # поднять демон в фоне (первый раз соберёт образ)
ops/bin/rebuild        # после правок кода: пересобрать и переката́ть, не выходя из фона
ops/bin/rebuild web    # пересобрать только web
ops/bin/health         # проверить оба сервиса
ops/bin/logs renderer  # логи
ops/bin/stop           # остановить демон
```
`rebuild` = `docker compose up -d --build` (слой-кеш → обычно пересборка за секунды).
HMR-режим (`ops/bin/dev docker`) — опционально; для стабильного демона он не нужен.

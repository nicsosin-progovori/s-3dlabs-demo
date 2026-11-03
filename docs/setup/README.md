# Развёртывание S. 3DLABS

_Черновик. Docker-вариант пока НЕ приведён к целевому виду — см. раздел ниже._

## Что поднимается
Из одного репозитория — два артефакта, в проде это один процесс:
- **Статический фронтенд** (Vite build → `dist/`): три страницы — `index.html`
  (студия SOURCE), `bottle.html` (страница бутылки + публичный API), `render.html`
  (невидимый worker для PNG).
- **Node-сервер** `server/start.mjs`: раздаёт `dist/`, публичный API (`/api/...`),
  рендерит PNG через headless-Chromium (Playwright), хранит логотипы.

## Требования
Node ≥ 22 (`.nvmrc` = 22). Для серверного PNG — Chromium Playwright (в Docker
берётся из базового образа `mcr.microsoft.com/playwright`).

## Локальный запуск
- `npm run dev` — только фронт, HMR → http://127.0.0.1:5173
- `npm run dev:bottle` — сервер + бутылочный API (`server/start.mjs`)
- `npm run build && npm start` — прод-подобно (`node server/start.mjs --production`);
  слушает `PORT` (деф. 5180), `HOST` (деф. 127.0.0.1); **требует собранный `dist`**.
- `npm run setup:browser` — поставить Chromium для тестов.
- Env: `PORT`, `HOST`, `BOTTLE_ALLOWED_ORIGINS` (CORS allowlist), `NODE_OPTIONS`.

## На любом сервере (как сейчас)
Собрать `dist` → перенести `dist/ server/ shared/ config/ models/` + `package.json`
+ lock → `npm ci --omit=dev` → `node server/start.mjs --production` за reverse-proxy
(TLS терминируется снаружи). Текущий прод — Selectel: Docker + systemd
(`ops/selectel/3dlabs.service`) + nginx + certbot (см. `docs/SELECTEL_DEPLOYMENT.md`).

## Docker — текущее состояние (как есть)
`ops/selectel/Dockerfile`: база Playwright, `npm ci --omit=dev`, копирует заранее
собранный `dist` + `server/shared/config/models`, healthcheck `/api/health`,
порт 5180. Работает, но заточен под один таргет и не самодостаточен:
- лежит в `ops/selectel/`, а не в корне → образ воспринимается как
  деплой-специфичный, а не как базовый артефакт продукта;
- **однослойный**: `COPY dist` — фронт собирается ВНЕ контейнера; из чистого клона
  одной командой образ не собрать;
- значения подогнаны под хост (память 160 МБ; имя контейнера с датой в systemd);
- нет `.dockerignore`, нет `docker-compose` для локали, нет разделения build/runtime.

## Docker — целевое состояние (предложение к совместному ревью)
Решение по Docker **обсуждаем вместе**; файлы пока не создаём. Направление —
вынести всю DevOps-часть в одну осознанную папку (предлагаю `ops/`), чтобы было
явно видно, что и как поднимается и что для этого нужно:
1. `ops/docker/Dockerfile` — multi-stage: `builder` (node:22) `npm ci && npm run
   build`; `runtime` (образ Playwright) копирует `dist` + `server/shared/config/
   models`, `npm ci --omit=dev`. Собирается из чистого клона.
2. `ops/docker/docker-compose.yml` — локальный `docker compose up`, env + volume под
   логотипы/результаты. `.dockerignore` — относительно контекста сборки
   (`ops/docker/Dockerfile.dockerignore` при BuildKit).
3. Хостовое — через env/ARG (PORT/HOST/BOTTLE_ALLOWED_ORIGINS/NODE_OPTIONS).
4. `ops/<target>/` (напр. `ops/selectel/`) — тонкий оверлей (systemd/nginx/certbot)
   поверх общего образа. Старый `ops/selectel/Dockerfile` держим до миграции.

Итог: `docker compose -f ops/docker/docker-compose.yml up` (или
`docker build -f ops/docker/Dockerfile .`) — на любой машине; Selectel — частный случай.

## Открытые вопросы (связь с архитектурой)
- Где хранить загруженные логотипы и PNG-результаты (локальный volume vs внешний
  сторейдж) — принцип «тело ≠ ссылка».
- Выделять ли PNG-рендер в отдельный сервис эфемерных инстансов, отделённый от
  раздачи статики — слой «Камера» / публичная API.

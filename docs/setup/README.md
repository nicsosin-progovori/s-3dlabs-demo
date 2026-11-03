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

## Docker — целевое состояние (предложение к перестройке)
1. **Корневой `Dockerfile`, multi-stage**: stage `builder` (node:22) → `npm ci` +
   `npm run build`; stage `runtime` (Playwright base) → копирует `dist` из builder +
   `server/shared/config/models`, `npm ci --omit=dev`. Собирается из чистого клона:
   `docker build .`.
2. **`.dockerignore`** (node_modules, .git, .cache, tests, src) — лёгкий контекст.
3. **Корневой `docker-compose.yml`** для локали: `docker compose up` поднимает
   сервис на `PORT`, пробрасывает env, volume под загруженные логотипы/результаты.
4. **Параметризация через env/ARG**: PORT/HOST/BOTTLE_ALLOWED_ORIGINS/NODE_OPTIONS/
   память — ничего не хардкодим под конкретный хост.
5. **`ops/<target>/` — тонкий оверлей** (systemd/nginx/certbot) поверх общего образа;
   таргет-специфика не смешивается со сборкой.
6. **Health/лимиты**: `/api/health` сохранить; ресурсные лимиты — в compose/
   оркестраторе, а не в образе.

Итог: `git clone && docker build && docker run` (или `docker compose up`) на любой
машине; Selectel — частный случай поверх того же образа.

## Открытые вопросы (связь с архитектурой)
- Где хранить загруженные логотипы и PNG-результаты (локальный volume vs внешний
  сторейдж) — принцип «тело ≠ ссылка».
- Выделять ли PNG-рендер в отдельный сервис эфемерных инстансов, отделённый от
  раздачи статики — слой «Камера» / публичная API.

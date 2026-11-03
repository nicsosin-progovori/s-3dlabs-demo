# Анатомия проекта: из чего состоит (черновик)

_Архитектурный разбор состава: сборка, пакеты, зависимости, модули, деплой.
Раздел про Docker/деплой — предложение к совместному ревью, НЕ финальное решение._

## Сборка (toolchain)
- **Vite 8** (`vite.config.ts`) — дев-сервер (HMR) и бандлер прод-сборки; внутри
  использует rolldown (`rolldownOptions`). React через `@vitejs/plugin-react`.
- **TypeScript 7** — `tsc --noEmit` как typecheck-гейт перед `vite build`
  (`npm run build` = typecheck + build).
- `base: './'` — относительные пути (работает и на GitHub Pages, и за прокси).
- `resolve.dedupe` — один экземпляр react/react-dom/three/@react-three/fiber.

### Точки входа и бандлы
Три входа (`rolldownOptions.input`): `index.html` (студия SOURCE), `bottle.html`
(страница бутылки + API), `render.html` (worker для PNG). Ручное разбиение чанков:
`three` (three.js) и `renderer` (@react-three/*) выносятся отдельно — тяжёлый 3D-код
кэшируется независимо от кода приложения.

## Зависимости (runtime)
- **react 19 / react-dom 19** — UI.
- **three 0.186** — 3D-движок.
- **@react-three/fiber 9** — React-рендерер для three.js (декларативный граф сцены).
- **@react-three/drei 10** — готовые хелперы к fiber.
- **playwright 1.64** — headless-Chromium для серверного PNG (используется и в рантайме
  сервера, не только в тестах).

### Зависимости (dev)
`@playwright/test`, `@vitejs/plugin-react`, `vite`, `typescript`, типы
(`@types/react`, `@types/react-dom`, `@types/three`). Node ≥ 22 (`.nvmrc`).

## Карта модулей
- **`shared/*.mjs` (+ `.d.mts`)** — контракты-валидаторы (render/scene/skin/camera/
  composition/branding). Чистый ESM без three.js; импортируются и клиентом, и
  сервером. Ядро: единый источник правды на оба рендерера.
- **`server/`** — Node-сервер (без фреймворка): `start.mjs` (HTTP, роутинг, раздача
  `dist`, static-range, CORS), `renderer.mjs` + `browser.mjs` (PNG через Playwright),
  `scenes.mjs` / `cameraViews.mjs` / `logos.mjs` (API доставки), `http.mjs`,
  `cors.mjs`.
- **`src/`** — фронтенд (React + fiber). Страницы/студии (`App`, `BottleApiPage`,
  `*Studio`, `*Scene`), загрузчики (`sceneLoader`, `skinLoader`), адаптеры слоёв
  (`bottle*`, `studio*`, `camera*`, `composition*`, `logo*`), i18n, стили.
- **`config/`** — рантайм-JSON доставки: `scenes/` (указатель + профили),
  `camera-views/bottle.json`.
- **`models/<product>/`** — спеки/манифесты/геометрия (мастер + эталонный GLB).
- **`public/`** — статика, раздаётся как есть: `models/` (GLB), `skins/bottle/`
  (skin.json по цветам), `textures/` (PNG, имена = sha256, immutable-кэш).
- **`scripts/`** — пайплайн подготовки моделей (Blender через `blender.mjs`,
  python-скрипты `prepare-*`), QA/сравнения, share-preview/ngrok, юнит-тесты `.mjs`.
- **`tests/`** — Playwright e2e (`.spec.ts`) + node:test контрактов.
- **`ops/selectel/`** — инфраструктура одного таргета (Dockerfile, systemd, nginx,
  certbot, benchmark).

## Поток данных (один контракт — два исполнителя)
`рантайм-JSON (config) → контракт-валидатор (shared) → замороженный объект →`
далее либо **живой рендер** (src + fiber + three), либо **серверный PNG**
(server/renderer → render.html worker → тот же объект → те же пиксели). Parity
гарантируется sha256-fingerprint с обеих сторон.

## Деплой и Docker — предложение к ревью
Текущий прод: Docker на Selectel + systemd + nginx + certbot. Сервер — один процесс
(раздаёт `dist` + API, PNG через Playwright).

**Проблема as-is**: `ops/selectel/Dockerfile` несамодостаточный (копирует заранее
собранный `dist`, фронт собирается вне контейнера) и заточен под один хост;
devops-часть размазана.

**Предложение (обсуждаем вместе, НЕ зафиксировано; файлы пока не создаём)** —
вынести ВСЮ devops-часть в одну осознанную папку, предлагаю `ops/` как единый дом,
чтобы было видно «что и как поднимается и что для этого нужно»:
- `ops/docker/` — общий образ: multi-stage `Dockerfile` (`builder` node:22 →
  `npm ci && npm run build`; `runtime` на образе Playwright копирует `dist` +
  `server/shared/config/models`, `npm ci --omit=dev`). Собирается из чистого клона.
- `ops/docker/docker-compose.yml` — локальный `docker compose up` (env + volume под
  логотипы/результаты). Нюанс к ревью: `.dockerignore` работает относительно
  контекста сборки — при `-f ops/docker/Dockerfile` с контекстом репо берём
  `ops/docker/Dockerfile.dockerignore` (BuildKit).
- Хостовое — через env/ARG (PORT/HOST/BOTTLE_ALLOWED_ORIGINS/NODE_OPTIONS).
- `ops/<target>/` (напр. `ops/selectel/`) — тонкий оверлей (systemd/nginx/certbot)
  поверх общего образа; Selectel — частный случай.

Итог после ревью и реализации: `docker compose -f ops/docker/docker-compose.yml up`
на любой машине; деплой-специфика изолирована в `ops/<target>/`.

## Открытые вопросы
Хранение логотипов/PNG (volume vs внешний сторейдж — «тело ≠ ссылка»). Отделять ли
PNG-рендер в отдельный сервис эфемерных инстансов (слой «Камера» / публичная API).

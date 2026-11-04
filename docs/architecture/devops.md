# DevOps — как устроены контейнеры (справка)

Пояснительный документ для владельца: термины и устройство нашей контейнеризации.
Практика и команды — в [`../setup/README.md`](../setup/README.md) и `ops/README.md`.

## Multi-stage: что такое «стадии»
В `Dockerfile` можно описать несколько **стадий** (`FROM … AS имя`). Стадия — это
временный мини-контейнер, живущий только во время сборки. Идея: собирать в «жирном»
окружении, а в прод отправлять «тонкое». У нас четыре стадии:

| Стадия | Роль | Едет в прод? |
| --- | --- | --- |
| `deps` | ставит все зависимости (вкл. dev) + кладёт исходники; на ней гоняем тесты | нет |
| `builder` | берёт `deps`, запускает `npm run build` → `app/dist` | нет (берётся только `dist`) |
| `runtime` | образ **renderer**: база с Chromium + прод-зависимости + `dist` | **да** (renderer) |
| `web` | **лёгкий web** без Chromium (`node:22-slim`); рендер уходит в renderer | **да** (web) |
| `dev` | образ dev-контейнера (браузер + все зависимости; исходники монтируются снаружи) | нет |

«builder/deps» — промежуточные стадии сборки; «runtime/dev» — конечные образы
(прод и разработка).

## Базовые образы и инструменты
- builder/deps → `node:22-bookworm`; runtime/dev → `mcr.microsoft.com/playwright:v1.64.1-noble` (с Chromium).
- Node 22, npm 12.2.1 (через `ARG NPM_VERSION` во всех стадиях + `packageManager` в `app/package.json`).

## Сервисы, порты, тома, профили
- `web` :5180 — раздаёт `dist` + delivery-API; `/api/render` пересылает в renderer (`RENDERER_URL`). Лёгкий образ без Chromium.
- `renderer` :5181 — Node + Chromium, серверный PNG.
- `dev` — dev-контейнер с синхронизацией (профиль `dev`).
- `proxy` :8080 — обратный прокси (профиль `edge`); роутит `/api/render` → renderer, остальное → web.
- Тома: `uploads` (логотипы/результаты, общий у web и renderer), `dev_node_modules`, `dev_cache`.
- Профили: default (web+renderer) · `dev` · `edge`. Профиль = сервис не поднимается в обычном `up`, только по `--profile`.

## Пульт `ops/bin/`
`up · start · stop · build · rebuild · edge · health · dev · sh · logs · test` — см. `ops/README.md`.

## Отложено
- **Пин базовых образов по digest (#4, позже).** Сейчас база по тегу (`node:22-bookworm`),
  теги «плавающие» — пересобираются с патчами. Пин по хешу (`…@sha256:…`) делает сборку
  полностью воспроизводимой. Гигиена ближе к проду.
- **CI-слой (#5, позже).** Автопрогон при пуше (напр. GitHub Actions): typecheck + тесты +
  сборка образа, публикация по git-sha. Снаружи репо, код не меняет.

## Дорожная карта расслоения (согласовано)
Все три опираются на один **код-шов**: web перестаёт рендерить сам и передаёт
`/api/render` в renderer (через env, напр. `RENDERER_URL`).
1. **Лёгкий web без Chromium** — ✅ сделано: стадия `web` на `node:22-slim`; web пересылает `/api/render` в renderer через env `RENDERER_URL` (сервер-сервер, без Origin). Образы теперь раздельные: `s-3dlabs-web` (лёгкий) и `s-3dlabs-renderer` (с браузером).
2. **renderer как воркер + очередь** — Фаза 3 (асинхронная галерея, см. `rendering-async.md`).
3. **`shared` как отдельный npm-пакет (workspaces)** — когда web и renderer станут раздельными сборками.
Порядок: (a) код-шов → (b) лёгкий web → (c) Фаза 3 и workspaces.

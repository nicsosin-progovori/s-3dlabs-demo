# Комментарии владельца к архитектуре (черновик, до синтеза)

_Собираем по ходу прохода по `README.md`. Выводы — после того, как владелец пройдёт весь файл._

## К принципу «Тело ≠ ссылка» / хранилище и природа проекта
- В перспективе из проекта **уедет всё**. Текущий проект — демо-аппликация с 1–10 проработанными объектами.
- Сами объекты будут храниться рядом, но **их структура вынесена за пределы проекта**; проект лишь подтягивает данные оттуда.
- Проект = **приложение-потребитель («движок»)**, которое умеет подгружать по-разному проработанные объекты: свет, тени, текстуры, камеры, набор операций, пресеты — подготовленные под конкретный продукт.
- Следствие (для будущего синтеза): объект — самодостаточный внешний пакет со своими слоями/пресетами; проект — рантайм, который его принимает и исполняет.

## К слою «Сцена» — создать отдельный документ
- Сущность сцены владельцу пока не до конца ясна — нужен **отдельный документ по сцене** (`04-scene.md`).
- Документ должен объяснить: зачем нужна сцена и что она делает; **как она резолвит** (что во что разворачивает); **допуск — кто может «зайти» в сцену, кто нет**; принципы работы; ограничения; возможности на уровне сцены.
- Статус: отложено до синтеза; не строим сейчас.

## К слою «Скин / материал» — создать отдельный документ
- Отдельный файл по сущности скина (`02-skin-material.md`), развёрнутый из архитектурного README.
- Общая конвенция (принята): всегда даём ссылки на поддокументы; основное описание в README сокращаем, детали переносим в поддокументы.
- Статус: отложено до синтеза; не строим сейчас.

## Принятые решения (setup)
- Рядом с архитектурой положен `overview.md` (репозиторная копия обзора); держим синхронно с README и обзором в Claude-проекте — правим проект → обновляем оба.
- Схемы: стандарт — Mermaid (```mermaid``` в MD), для тяжёлых — draw.io. Помечено в README (раздел «Инструменты документации»).
- Интерфейсы: TypeScript подходит (проект уже TS, рядом с контрактами есть `.d.mts`). Заведён `interfaces.md` как карта типов со ссылкой на `shared/*.d.mts`.

## Уточнение по Docker/DevOps (от владельца)
- Всю DevOps-часть вынести в **одну осознанную папку** (предложено `ops/`): видно, что и как поднимается и что нужно.
- Предложенная структура: `ops/docker/` (общий образ + compose) + `ops/<target>/` (оверлей systemd/nginx/certbot). Файлы пока НЕ создаём — сначала ревью.

## Решения по DevOps/топологии (от владельца)
- Идём **School B**: devops сверху, приложение в подпапку (`app/`), прод + масштабирование.
- Рендер — **два сервиса**: `web` (dist + delivery API + оркестрация) и `renderer` (Node+Chromium, эфемерные воркеры).
- Факт из кода: сейчас web+renderer слиты, Chromium грузит `render.html`/ассеты по общему origin — при разделении решить путь ассетов (по сети из web / своя копия dist).
- Нужна инфра-схема окружения → сделана в `environment.md` (+ картинки). Далее: сегментация и план миграции `app/`.

## Решения/уточнения (телефонный заход)
- Vite — только dev/сборка; «контейнер под Vite» = builder-стадия; прод без dev-части работает при готовом dist. Зафиксировано в migration-plan.
- Имя подпапки приложения — `app/` (не Next.js; Vite React + Node API).
- Reverse proxy + TLS — только оснастка в `ops/`, в dev не нужен.
- Renderer переопределён: **асинхронная галерея** (не онлайн-рендер) → `rendering-async.md`.
- index.html (App, мультипродукт) vs bottle.html (BottleApiPage, эталон одного продукта с API/PNG). Цель — слить в один динамический плеер (Фаза 4), зависит от per-product адаптеров.
- Планы разложены по фазам с точками проверки в `migration-plan.md`. Реализация — по команде владельца с компьютера.

## Фаза 1 запущена (владелец за ПК, развилки отвечены)
- Развилки: (1) renderer — своя копия dist (TODO ревью: сеть из web); (2) polling — заглушка + TODO; (3) очередь in-process + volume на старте.
- Создано (код не трогали, git не коммитили): `ops/docker/` (Dockerfile multi-stage, compose web+renderer+edge-proxy, nginx.conf, .env.example, Dockerfile.dockerignore), `ops/bin/` (up/build/sh/logs/test), `ops/README.md`.
- Точка проверки 1: `ops/bin/up` → web :5180 + renderer :5181, оба `/api/health` ок, страница грузится, рендер PNG работает; `ops/bin/test` зелёный. Ждём результат проверки владельцем.

## Точка проверки 1 — ЗЕЛЁНАЯ
- `ops/bin/test`: 71/71 юнит-тестов прошли (в контейнере, стадия deps). Контейнеры web:5180 + renderer:5181 поднимаются.
- bin пополнен: start (= up -d), stop (down). Dockerfile получил стадию deps.
- Фаза 2 расписана детально в migration-plan.md; ждём «go» и 2 решения (assets/.nojekyll; Claude outputs).

## Фаза 2 выполнена локально (ждёт проверки)
- Приложение перенесено в `app/` (mv, история сохранится при коммите владельца). В корне: app/ ops/ docs/ README.md AGENTS.md .gitignore .idea.
- Удалены устаревшие GH Pages-артефакты: `assets/` (5 файлов, были в git), `.nojekyll`. Схемы перенесены в `docs/architecture/diagrams/`; «Claude outputs/» убрана, добавлена в .gitignore.
- Правки: ops/docker/Dockerfile (COPY app/*), Dockerfile.dockerignore (**/node_modules|dist|.cache), пути в доках (src/→app/src и т.п.), ops/selectel/Dockerfile помечен DEPRECATED, ops/README dev-команды из app/.
- Относительные пути (vite/tsconfig/server root/playwright/скрипты) править не пришлось — переехали вместе.
- НЕ трогали (историческое): root README пути, SELECTEL_DEPLOYMENT scope_paths — опциональный follow-up.
- Точка проверки 2 у владельца: ops/bin/up (пересборка) → health; ops/bin/test зелёный; /bottle.html + PNG; dev из app/.

## Dev-контейнер с синхронизацией
- Добавлена стадия `dev` (Playwright base + полные зависимости) и сервис `dev` (профиль dev) в compose.
- bind-mount `app/ ↔ контейнер` (исходники и app/dist синхронны с хостом); `node_modules`/`.cache` — в named volumes (не на хост: платформенные бинарники), в git не идут.
- Запуск: `ops/bin/dev docker`. HMR через CHOKIDAR_USEPOLLING. web/renderer сборки получили явный target: runtime.

## Контейнеры: доработки
- Прокси был под профилем `edge` (поэтому не поднимался обычным start/up) — добавлена команда `ops/bin/edge` (web+renderer+proxy, :8080).
- npm поднят до 12.2.1: ARG NPM_VERSION в Dockerfile (ставится во всех стадиях) + packageManager в app/package.json.
- restart: unless-stopped закомментирован (демон on-demand).

## Решения
- Разъяснения по devops вынесены в docs/architecture/devops.md (справка для владельца).
- #4 (digest pin) и #5 (CI) — отложены («позже»).
- Расслоение 1/2/3 согласовано; порядок: код-шов web→renderer → лёгкий web → Фаза 3/workspaces. Код-шов — следующий шаг (изменения в app/server, с точкой проверки).

## Код-шов + лёгкий web (сделано, ждёт проверки)
- app/server/start.mjs: /api/render при заданном RENDERER_URL пересылает запрос в renderer (fetch, без Origin → проходит assertRequestOrigin), возвращает PNG и X-Render-* заголовки; без RENDERER_URL — рендерит локально (как раньше).
- Dockerfile: стадия web (node:22-slim, без Chromium) + стадия runtime (renderer, Playwright). Два образа: s-3dlabs-web, s-3dlabs-renderer.
- compose: web → target web + RENDERER_URL=http://renderer:5181 + depends_on renderer; renderer → target runtime.
- dev-контейнер (монолит) и прямой renderer:5181 рендерят локально (RENDERER_URL не задан).
- Проверка 3: rebuild → health оба ок; /bottle.html + PNG (через web→renderer); test 71/71; web-образ заметно меньше renderer.

## Виртуалхост scena.develop
- nginx.conf: server_name scena.develop + proxy_set_header Host $host (иначе Origin!=Host → 403 на POST).
- proxy на порт ${EDGE_PORT:-80}:80. Запуск: ops/bin/edge → http://scena.develop (нужна запись 127.0.0.1 scena.develop в /etc/hosts хоста).

## Режимы запуска взаимоисключающие (one at a time)
- start/edge/dev docker — разные режимы на одних портах 5180/5181. Теперь up/start/edge/dev docker сами делают down прежнего режима (--profile dev --profile edge down) перед подъёмом. rebuild — in-place (без down). stop — гасит всё.
- Хост-dev (ops/bin/dev, npm) нельзя погасить через compose — перед ним ops/bin/stop.

## Баг «модель без текстур на scena.develop» — решён
- Симптом: через прокси текстуры не запрашивались (меньше файлов, console пусто), модель без скина.
- Причина: nginx по умолчанию ходит к апстриму по HTTP/1.0 → артефакт транспорта → строгая проверка в skinLoader (`data.byteLength!==size`) падает → манифест скина не проходит → текстуры не грузятся. GLB грузился (там такой проверки нет).
- Фикс (nginx.conf): proxy_http_version 1.1 + Connection "" (+ proxy_set_header Host $host для Origin==Host). Проверено: skin.json и текстуры байт-в-байт равны прямому доступу (597 и т.д.), коды 200.
- Вариант 1 применён: proxy всегда в стеке, start даёт scena.develop; edge → алиас start.

## Корень бага: secure context (crypto.subtle)
- http://scena.develop — не secure context (не loopback) → window.crypto.subtle undefined → проверки SHA-256 в skinLoader/sceneLoader бросают → скин/сцена не грузятся, текстуры не запрашиваются (0). На 127.0.0.1 работает (secure context).
- Решение (выбран вариант 2): HTTPS на прокси. Самоподписанный cert ops/docker/certs/scena.develop.pem (SAN scena.develop/localhost/127.0.0.1), nginx 443 ssl + 80→443 редирект, compose публикует 443 + монтирует certs. certs в .gitignore.
- Доступ: https://scena.develop; cert доверить в Keychain (или проскочить предупреждение — secure context всё равно включается).

## Окружения как start-режимы + видимое состояние + версии прода
- ops/bin/start [dev|test|production], dev по умолчанию. dev — HMR-контейнер (:5180, localhost); test — юнит-тесты; production — сборка + тег образа = git-sha + запись в ops/releases.log + web+renderer+proxy на https://домен.
- Запуск конкретной версии: ops/bin/start production <sha> (IMAGE_TAG=<sha>, без пересборки). compose: image: s-3dlabs-web/renderer:${IMAGE_TAG:-latest}.
- Состояние вынесено в видимую папку volumes/ (bind → /app/.cache/uploads у web/renderer/dev); в git только volumes/README.md.
- Факты для владельца: .env — dotfile (есть, скрыт IDE); app/dist на хосте нет (собирается в образе) — это норма; мусора нет.
- dev=localhost (secure context ok), production=домен по HTTPS.

## Шаг 1 externalization сделан
- Собран objects/bottle/v01/ (копия ассетов студии; студия не тронута): geometry/skins/textures/scene/camera/spec + manifest.json (39 файлов, sha+size, 8.7M).
- git: objects/**/*.glb и *.png игнорируются (бинарники не дублируем), манифесты/json видны.
- Архитектура в docs/architecture/objects.md. iframe-направление снято (не цель владельца).
- Дальше: шаг 2 — рантайм-загрузчик по ID (читает manifest, грузит, рендерит).

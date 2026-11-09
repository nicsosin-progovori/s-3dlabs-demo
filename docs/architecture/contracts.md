# Контракты данных плеера: какие JSON, кто их читает, как они подключаются

_Статус: **на ревью** (8 ноя 2026). Касается только нового плеера (`app/src/player/`); старая студия и примеры живут по своим контрактам (`app/shared/*Contract.mjs`)._

## Где лежат контракты

```
app/contracts/
  shadow.schema.json             — пакет тени: shadows/<id>/<rev>/shadow.json
  shadow-declaration.schema.json — выбор тени объектом: manifest.render.shadow
  skin-surface.schema.json       — что объект принимает как скин: manifest.render.skin
  skin.schema.json               — скин: <dir>/<id>/<rev>/skin.json
  skin-enhancement.schema.json   — улучшение скина: поле "enhancement" в skin.json
  scene.schema.json              — сцена: scenes/<id>/<rev>/scene.json
  scene-declaration.schema.json  — выбор сцен объектом: manifest.render.scenes
  scene.ts                       — типы сцены (+ единицы объекта)
  skin.ts                        — типы скина
  shadow.ts                      — типы TypeScript для этих JSON (для кода плеера)
  skinEnhancement.ts
```

На каждый JSON три вещи:

1. **JSON Schema** (`*.schema.json`, draft 2020-12) — главный, машиночитаемый контракт. Его можно отдать 3D-команде или другому сервису, по нему подсказывает редактор. В самом файле данных ставится ссылка на схему: `"$schema": "../../../app/contracts/shadow.schema.json"`.
2. **Типы TypeScript** (`*.ts` рядом) — та же форма для кода плеера.
3. **Эта страница** — цепочка подключения и правила.

**Проверка сейчас (решение владельца, 8 ноя 2026):** плеер проверяет данные своими строгими проверками (`shadowSocket.ts`, `skinEnhancement.ts`), библиотека-валидатор JSON Schema пока не подключена. Тест `app/scripts/contracts.test.mjs` (`npm run test:player`) прогоняет реальные файлы проекта через проверки плеера и сверяет обязательные поля и состав полей со схемой — расхождение данных и контракта роняет тесты.

## Цепочка подключения

```mermaid
flowchart TD
  SKU["skus/&lt;SKU&gt;/sku.json<br/>simple: object + skin"] -->|object: id@rev| M["objects/&lt;id&gt;/&lt;rev&gt;/manifest.json"]
  SKU -->|skin: id@rev| SK["objects/…/&lt;dir&gt;/&lt;id&gt;/&lt;rev&gt;/skin.json<br/>sha в manifest.parts.skins<br/>skin.schema.json"]
  M -->|render.skin: совместимость, слоты<br/>skin-surface.schema.json| SK
  SK -->|enhancement: file+sha256<br/>skin-enhancement.schema.json| EJ["…/enhancement.js"]
  M -->|render.scenes: [id@rev, …] — первая<br/>scene-declaration.schema.json| SC["scenes/&lt;id&gt;/&lt;rev&gt;/scene.json<br/>scene.schema.json"]
  H["хост: s3d:scene"] -.->|смена сцены у показанного объекта| SC
  SC -->|свет: направление и чёткость тени<br/>needsFromScene| SH
  SC -->|code: file+sha256| SCJ["scenes/…/scene.js<br/>слот сцены"]
  M -->|render.shadow.use: id@rev<br/>shadow-declaration.schema.json| SH["shadows/&lt;id&gt;/&lt;rev&gt;/shadow.json<br/>shadow.schema.json"]
  SH -->|entry: file+sha256| SJ["shadows/…/shadow.js"]
  M -->|render.shadow.params| P["проверка по SH.params"]
```

| Звено | Файл | Кто читает | Контракт | При ошибке |
|---|---|---|---|---|
| 1 | `skus/<SKU>/sku.json` | `player/engine/skuLoader.ts` | (пока код) | плеер `error` |
| 2 | `objects/<id>/<rev>/manifest.json` | `player/engine/objectLoader.ts` | (пока код) | плеер `error` |
| 3 | `manifest.render.skin` | `player/materials/skinContract.ts` | `skin-surface.schema.json` | нет поля → объект без скинов; скин по SKU → `error` |
| 3b | `<dir>/<id>/<rev>/skin.json` | `player/materials/skinLoader.ts` + `skinContract.ts` | `skin.schema.json`; совместимость и слоты — по `render.skin` | чужая совместимость / лишний или пропущенный слот → `error` |
| 3a | `skin.json` → `enhancement` | `player/materials/skinEnhancement.ts` | `skin-enhancement.schema.json` | плеер `error` (TODO: откат к базовому скину) |
| 4 | `manifest.render.shadow` | `player/sockets/shadowSocket.ts` | `shadow-declaration.schema.json` | нет поля / неверный ключ → `error`; `null` → без тени |
| 5 | `shadows/<id>/<rev>/shadow.json` | `player/sockets/shadowSocket.ts` | `shadow.schema.json` | `error` |
| 5a | `render.shadow.params` | `resolveShadowParams` | `params` из `shadow.json` выбранной тени | параметр вне границ / лишний → `error` |
| 5b | `shadows/…/shadow.js` | `player/packages/packageCode.ts` | размер + sha256 из `entry`, `apiVersion` | `error` |
| 6 | `manifest.render.scenes` | `player/scenes/sceneContract.ts` (`sceneDeclaration`) | `scene-declaration.schema.json` | нет поля / пусто / неверный ключ / дубль → `error` |
| 6a | `manifest.render.units`, `render.scale` | `objectToMetres` | `scene.ts` (`ObjectUnits`); `scale` > 0, по умолчанию 1 | неизвестные единицы / неверная поправка → `error` |
| 7 | `scenes/<id>/<rev>/scene.json` | `player/scenes/sceneLoader.ts` + `sceneContract.ts` | `scene.schema.json`, ≤ 64 КиБ | нет файла / битый JSON / вне контракта / чужая identity → `error` (и при смене сцены хостом) |
| 7b | `scene.json` → `code` + код сцены | `player/sockets/sceneSocket.ts` + `packages/packageCode.ts` | `scene.schema.json` (`code`); размер + sha256, `apiVersion` | `error` |
| 7a | свет сцены для тени | `shadowLightFromScene` (`shadowSocket.ts`) | `needsFromScene` тени + `key.position`, `shadow.radius`, `shadow.lightMapSize` | чего-то нет → `error` (проверяется при каждой смене сцены) |

Пути: объекты — `/objects/`, SKU — `/skus/`, тени — `/shadows/`, сцены — `/scenes/` (сервер, `OBJECTS_DIR` / `SKUS_DIR` / `SHADOWS_DIR` / `SCENES_DIR`). Пути внутри пакетов — от папки пакета, без `..` и без ведущего `/`.

## Правила для любого нового контракта

- Новый JSON → сначала схема в `app/contracts/`, затем типы, затем строка в таблице выше.
- Версии: формат файла — `schemaVersion`; API кода пакета — `apiVersion`. Изменение любой из них — ревью.
- Код из пакета грузится только после проверки размера и sha256.
- Ошибки строгие: несоответствие контракту — ошибка показа, без молчаливых умолчаний (кроме явных `default` в контракте).
- Звенья 1–2 (SKU, манифест объекта целиком) пока описаны только кодом — схемы добавляем по мере работы над ними.

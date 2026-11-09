# app/src/player — новый плеер (ObjectViewer)

Вход: `index.html` → `ObjectViewer.tsx`. Старая студия и примеры (`src/*`, `example1.html`, `bottle.html`) — отдельно, не трогаем.

```
ObjectViewer.tsx   — точка входа: состояние плеера, Canvas
components/        — React-компоненты кадра: Backdrop, Rig, ShadowSlot, SceneSlot, CameraFilm, MaterialFrames
engine/            — без React: objectLoader, objectEngine, placement (объект в сцене), scenePolicy (выбор сцены), skuLoader, playerContract (host ↔ player)
materials/         — пул обработчиков материалов, скин (копия загрузчика для плеера; проверка скина по объекту — skinContract.ts), улучшение скина
sockets/           — гнёзда для пакетов: shadowSocket (тень), sceneSocket (код сцены)
scenes/            — сцена как отдельная сущность: sceneContract (проверка scene.json, render.scenes, единицы объекта), sceneLoader (/scenes/<id>/<rev>/)
packages/          — проверка и загрузка кода из пакетов (размер + sha256)
```

Объект собирается без сцены (`buildFromManifest`), в сцену его ставит `placeInScene` (`engine/placement.ts`) — при загрузке и при каждой смене сцены.
Код сцены (если есть) — в слоте `components/SceneSlot.tsx`.

Контракты данных — `app/contracts/`, документация — `docs/architecture/contracts.md`, сцена — `docs/architecture/04-scene.md`.

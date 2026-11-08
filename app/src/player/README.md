# app/src/player — новый плеер (ObjectViewer)

Вход: `index.html` → `ObjectViewer.tsx`. Старая студия и примеры (`src/*`, `example1.html`, `bottle.html`) — отдельно, не трогаем.

```
ObjectViewer.tsx   — точка входа: состояние плеера, Canvas
components/        — React-компоненты кадра: Backdrop, Rig, ShadowSlot, CameraFilm, MaterialFrames
engine/            — без React: objectLoader, objectEngine, skuLoader, playerContract (host ↔ player)
materials/         — пул обработчиков материалов, скин (копия загрузчика для плеера), улучшение скина
sockets/           — гнёзда для пакетов, которые выбирает объект: shadowSocket (тень)
packages/          — проверка и загрузка кода из пакетов (размер + sha256)
```

Контракты данных — `app/contracts/`, документация — `docs/architecture/contracts.md`.

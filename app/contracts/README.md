# app/contracts — контракты данных нового плеера

JSON Schema (`*.schema.json`) + типы TypeScript (`*.ts`) для JSON, которые читает плеер `app/src/player/`.
Цепочка подключения, таблица «файл → кто читает → что при ошибке» и правила — `docs/architecture/contracts.md`.
Тест соответствия реальных файлов: `npm run test:player` (`scripts/contracts.test.mjs`).

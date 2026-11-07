# 02 · Скин — единый загрузчик (проект, на обсуждение)

_Статус: **черновик для ревью** (7 ноя 2026). Код не менялся. Закрывает [ISSUES I-01](../../ISSUES.md)._

**Цель.** Плеер не знает заранее, какие скины бывают у объекта. Скин приезжает вместе с пакетом объекта.
Внутри скина могут быть данные (JSON), код или их сочетание. Движок предоставляет точку подключения и общий жизненный цикл, а реализация остаётся внутри скина.

---

## 1. Что есть в проекте сейчас (инвентаризация)

| Объект | Как задан «цвет/материал» | Где живёт логика | Текстуры |
|---|---|---|---|
| **bottle** (плеер, `objects/bottle/v01`) | Внешний скин `skin.json`: подмножество glTF-материалов, привязанных к слотам `extras.materialSlotId`; профили `low`/`final` | `skinLoader.ts` — сверка с глобальным `bottleSkins.json`, **ровно 7 слотов** | отдельно, имя = sha256, общие для всех скинов объекта |
| **bottle** (старая студия) | Материалы зашиты в GLB; `BottleCoating` перекрашивается из `specification.colors` (hex/metalness/roughness) | `sourceModel.configureSourceModel` | внутри GLB |
| **endo** | Материалы зашиты в GLB; перекраска **по префиксу имени**: `EndoStrap*` ← `hex`, `EndoFrame*` ← `frame` | `sourceModel.configureSourceModel` | внутри GLB (normal/roughness ткани) |
| **pillow** | Один цвет, материалы в GLB; правки на объекте: `shadowSide`, анизотропия, отключение тени у швов по regex | `PillowScene.tsx` | внутри GLB |
| **mug / notebook / pen** | Без вариантов; только материал печати (`LOGO_PRINT`, `DIGITAL_PRINT`, `LASER_ENGRAVING`) | `model.ts printableMaterial`, `Scene.tsx` | внутри GLB |

Поверх любого материала движок сейчас применяет и общие правки, которые к самому скину не относятся:
`bottleSoftShadows()` — патч шейдера под мягкие тени; `envMapIntensity = 1`; `anisotropy = 8` (только для бутылки); переворот `normalScale.y` при производных тангентах.

**Вывод.** Сейчас в проекте три разных механизма. **Слот-скин** (бутылка) — уже почти правильная модель: геометрия и внешний вид разделены, связь идёт через слоты. **Перекраска по имени** (endo, старая бутылка) по сути тоже скин, только параметрический и поверх «родных» материалов GLB. **Материал печати** — это нанесение логотипа, а не скин; это отдельный слой, см. I-07.

## 2. Ключевая идея

Разделяем три вещи:

1. **Поверхность скина** объявляет **объект**: какие у него слоты и под каким именем-версией интерфейса (`skinInterface`). Это аналог интерфейса в ООП.
2. **Скин** объявляет, какой интерфейс он реализует (`implements`), и как именно — через `kind`.
3. **Драйвер** — код, который умеет выполнить скин данного `kind`.
   - Драйверы для данных (`slots`, `tint`) лежат в движке. Они generic, их немного, объектов они не знают.
   - Драйвер `module` загружает **программный скин** из пакета объекта. Дальше скин сам решает, как себя реализовать: может сгенерировать текстуры, собрать материал, поправить шейдер в рамках своих слотов.

Совместимость проверяется так: `skin.implements === object.skinInterface.id`. Глобальный реестр скинов и константа бутылки больше не нужны.

```mermaid
flowchart LR
  SKU[SKU simple: object + skin] --> E[Движок]
  M[manifest объекта<br/>skinInterface + slots] --> E
  E -->|kind| R{реестр драйверов}
  R -->|slots| D1[SlotsDriver<br/>glTF-материалы по слотам]
  R -->|tint| D2[TintDriver<br/>параметры поверх родных материалов]
  R -->|module| D3[ModuleDriver<br/>import скин.js из пакета]
  D1 & D2 & D3 --> P[PreparedSkin]
  P -->|apply SkinTarget| A[AppliedSkin]
  A --> PP[общий пост-процесс материалов<br/>тени, envMap — не скин]
```

## 3. Интерфейсы (TypeScript)

```ts
/** ── Объявляет ОБЪЕКТ (manifest.render.skin) ───────────────────────────── */
interface ObjectSkinSurface {
  /** имя+версия интерфейса скина: 'bottle-materials-v01', 'endo-materials-v01' */
  interface: string
  /** слоты, доступные скину; остальное скину недоступно */
  slots: Array<{ id: string; label?: Record<string, string> }>
  /** как найти слот в GLB: extras.materialSlotId (готово к скинам) или по имени материала (миграция) */
  binding: { by: 'extras' } | { by: 'materialName'; map: Record<string /*glTF material*/, string /*slot*/> }
  /** что лежит в GLB на месте слотов: полноценные материалы или заглушки */
  baseMaterials: 'embedded' | 'placeholder'
  defaultSkin: string                 // 'endo-black@v01'
}

/** ── Объявляет СКИН (skins/<id>/<rev>/skin.json) ────────────────────────── */
interface SkinDescriptor {
  schemaVersion: 2
  id: string; revision: string
  implements: string                  // === ObjectSkinSurface.interface
  kind: 'slots' | 'tint' | 'module'   // какой драйвер исполняет
  /** kind='module': точка входа кода внутри пакета, с sha (код — тоже часть, проверяем целостность) */
  entry?: { file: string; sha256: string; bytes: number }
  /** данные для драйвера / параметры для модуля; движок их НЕ читает */
  data?: unknown
}

/** ── Что движок даёт скину (единственная «поверхность» объекта) ──────────── */
interface SkinTarget {
  object: { id: string; revision: string; interface: string }
  quality: 'low' | 'final'
  slots: ReadonlyMap<string, SlotHandle>
  /** движок: загрузка частей пакета с проверкой sha, кэш текстур по sha, общий three */
  resources: SkinResources
}
interface SlotHandle {
  id: string
  meshes: readonly import('three').Mesh[]        // только чтение: геометрию скин не трогает
  base: import('three').Material | null          // «родной» материал из GLB (для tint/module)
  set(material: import('three').Material): void  // единственный способ изменить вид
}
interface SkinResources {
  three: typeof import('three')                   // единый экземпляр three движка
  part(file: string, signal: AbortSignal): Promise<ArrayBuffer>      // только файлы из manifest, sha проверяется
  texture(file: string, opts: TextureOptions, signal: AbortSignal): Promise<Lease<import('three').Texture>>
}

/** ── Драйвер (код движка или модуль скина) ──────────────────────────────── */
interface SkinDriver {
  kind: string
  prepare(desc: SkinDescriptor, res: SkinResources, quality: 'low' | 'final', signal: AbortSignal): Promise<PreparedSkin>
}
interface PreparedSkin {
  /** применить к живой модели; повторный apply другого скина того же интерфейса = смена без перезагрузки геометрии */
  apply(target: SkinTarget): AppliedSkin
  dispose(): void
}
interface AppliedSkin {
  dispose(): void          // вернуть слоты в исходное состояние, освободить ресурсы
}

/** ── Программный скин: файл из пакета, export default ──────────────────── */
interface SkinModule {
  apiVersion: 1            // версия API движка для скинов; движок отклоняет несовместимую
  prepare(data: unknown, res: SkinResources, quality: 'low' | 'final', signal: AbortSignal): Promise<PreparedSkin>
}
```

**Как это ложится на существующие объекты**

| Объект | kind | Что в `data` |
|---|---|---|
| bottle | `slots` | текущий `skin.json` почти без изменений: `materials[]` + `profiles` |
| endo | `tint` (на старте) → `slots` (после разбора GLB) | `{ "strap": {"color":"#24272c"}, "frame": {"color":"#343940"} }` поверх `baseMaterials: embedded` |
| pillow / pen / mug / notebook | `tint` или единственный «родной» скин | один скин `*-default@v01` с пустым `data` — правило «у simple всегда есть скин» не ломается |
| будущее (процедурная ткань, Pantone, градиент) | `module` | параметры модуля |

## 4. Что меняется в движке (когда начнём реализацию)

1. `compatible()` / `normaliseSkin()` / `SKIN_COMPATIBILITY` / проверка «ровно 7» удаляются. Вместо них сверяется `implements` с интерфейсом объекта, а слоты проверяются по поверхности объекта: каждый слот скина есть у объекта, обязательные слоты закрыты.
2. `bindSkin()` превращается в построение `SkinTarget` из GLB (слоты по `binding`) и вызов `apply`. Код перекраски по префиксам имён уходит из `sourceModel.ts`.
3. Общий **пост-процесс материалов** — отдельный шаг движка после `apply`: тени (`bottleSoftShadows` → нейтральное имя), `envMapIntensity`, тангенты. Скин об этом не знает. Объектные подсказки (анизотропия, `shadowSide`) — в `manifest.render`, а не в коде.
4. Нынешний `skinLoader.ts` целиком становится `SlotsDriver` — логика текстур, кэша и sha переиспользуется.

Объём работ: шаг 1 небольшой и разблокирует endo через `tint`. Шаги 2–4 — средний рефакторинг, затрагивает студию (`App`, `BottleApiPage`), нужно ревью.

## 5. Вопросы к владельцу

1. **Код из пакета объекта (`kind: module`).** Это исполнение кода, пришедшего из хранилища, — и в браузере клиента, и в PNG-рендерере. Достаточно ли проверки sha по манифесту плюс доверенного источника пакетов? Или нужна изоляция (worker / iframe) или подпись пакетов? Предлагаю на старте доверять пакетам и проверять sha, а `module` сделать последним шагом.
2. **Границы скина.** Что скин может менять: только материалы своих слотов? Видимость частей (например, «вариант без крышки»)? Геометрию — нет? Предлагаю ограничиться материалами слотов. Видимость — только у частей, которые объект явно объявил управляемыми скином.
3. **Привязка к слотам.** Можно ли на переходный период находить слоты по имени материала через карту в манифесте, без перепаковки GLB? Или сразу требовать `extras.materialSlotId`, то есть prepare-шаг для каждого объекта?
4. **Где живут скины.** Только внутри ревизии объекта (`objects/<id>/<rev>/skins/`), как сейчас? Или бывают общие скины на несколько объектов (общая палитра бренда)? Если общие — `implements` позволяет такое без изменения формата.
5. **Параметры от SKU.** SKU передаёт только `skin: id@rev`, или ещё и параметры (например, цвет Pantone под клиента — один скин-модуль на много цветов)? Предлагаю пока только ключ; параметры — отдельное решение.
6. **Версия API скинов** (`apiVersion`) и версия `three`. Программный скин обязан использовать `three` движка (`res.three`), а не свой импорт. Согласны ли вы держать API скинов как публичный контракт с версией?
7. **Fingerprint PNG.** В кэш-ключ рендера входит sha дескриптора скина. Для `module` — ещё sha кода и всех прочитанных частей. Согласны?

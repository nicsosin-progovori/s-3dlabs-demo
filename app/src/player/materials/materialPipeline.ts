import type { Camera, Material, Object3D, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
 * ПУЛ ОБРАБОТЧИКОВ МАТЕРИАЛОВ — единственная точка, через которую что-либо
 * дорабатывает материал ПОВЕРХ базового скина: улучшения скина (код из пакета),
 * смешивание LOD, нанесение (брендинг), тени и прочие общие правки движка.
 *
 * Зачем: three.js даёт ОДИН крючок на материал (onBeforeCompile) и ОДИН ключ
 * программы (customProgramCacheKey). Раньше каждый патч оборачивал предыдущий
 * сам — порядок зависел от того, кто позвал первым, а ключи затирали друг друга.
 * Пул ставит на материал один диспетчер и вызывает процессоры в ФИКСИРОВАННОМ
 * порядке: стадия (MATERIAL_STAGES) → order → момент подключения.
 *
 * Стандарт: docs/architecture/02-skin.md § «Пул обработчиков материалов».
 * ──────────────────────────────────────────────────────────────────────────── */

/** Стадии пула, строго в порядке исполнения. Новая стадия = изменение контракта (ревью). */
export const MATERIAL_STAGES = [
  'skin',      // улучшения скина: программная часть из пакета скина (skinEnhancement.ts)
  'lod',       // переходы качества low → final (bottleLodAppearance.ts)
  'branding',  // нанесение логотипа/декора поверх материала (зарезервировано, I-07)
  'lighting',  // общие правки движка: мягкие тени и т.п. — последними, над итоговым шейдером
] as const
export type MaterialStage = typeof MATERIAL_STAGES[number]

/** Что процессор получает на каждом кадре. Только камера и размер — без времени и случайности,
 *  чтобы PNG-рендер был повторяемым (один кадр → один результат → один fingerprint). */
export interface MaterialFrame {
  camera: Camera
  size: { width: number; height: number }
}

/** Контракт процессора пула. */
export interface MaterialProcessor {
  /** Уникален в пределах материала: '<источник>.<назначение>', напр. 'engine.shadows.pcss'.
   *  Повторное подключение с тем же id ЗАМЕНЯЕТ прежний процессор (идемпотентность). */
  readonly id: string
  readonly stage: MaterialStage
  /** Порядок внутри стадии, по возрастанию. По умолчанию 0. */
  readonly order?: number
  /** Вклад в ключ шейдерной программы. Обязан меняться, если меняется текст шейдера,
   *  который даёт patch(); иначе three переиспользует чужую скомпилированную программу. */
  programKey(): string
  /** Правка шейдера перед компиляцией: текст и uniforms. Без побочных эффектов на сцену. */
  patch?(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer, material: Material): void
  /** Обновление на кадр: только uniforms/параметры материала, программу не пересобирает. */
  onFrame?(frame: MaterialFrame, material: Material): void
}

export interface ProcessorHandle {
  /** Снять процессор с материала; материал пересоберётся при следующем рендере. */
  detach(): void
}

interface PoolState {
  processors: Array<{ processor: MaterialProcessor; seq: number }>
  base: Material['onBeforeCompile'] | null
  baseKey: (() => string) | null
}

// Состояние — в WeakMap, а НЕ в material.userData: Material.copy() перезаписывает userData
// (смена скина делает target.copy(recipe)), а диспетчер и ключ остаются на материале.
const pools = new WeakMap<Material, PoolState>()
const rank = new Map<MaterialStage, number>(MATERIAL_STAGES.map((s, i) => [s, i]))
let sequence = 0
let framed = 0 // сколько подключено процессоров с onFrame — чтобы не обходить сцену зря

function sorted(state: PoolState) {
  return [...state.processors].sort((a, b) =>
    rank.get(a.processor.stage)! - rank.get(b.processor.stage)! ||
    (a.processor.order ?? 0) - (b.processor.order ?? 0) || a.seq - b.seq)
}

function install(material: Material): PoolState {
  let state = pools.get(material)
  if (state) return state
  const own = Object.prototype.hasOwnProperty
  // Если у материала уже был свой onBeforeCompile (не из пула) — он исполняется ПЕРВЫМ,
  // как «родная» часть материала. Свой ключ программы учитываем, только если он был задан явно.
  const base = own.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null
  const baseKey = own.call(material, 'customProgramCacheKey') ? material.customProgramCacheKey.bind(material) : null
  state = { processors: [], base, baseKey }
  pools.set(material, state)
  const pool = state
  material.onBeforeCompile = function (shader, renderer) {
    pool.base?.call(this, shader, renderer)
    for (const { processor } of sorted(pool)) processor.patch?.(shader, renderer, material)
  }
  material.customProgramCacheKey = () =>
    [...(pool.baseKey ? [pool.baseKey()] : []), ...sorted(pool).map(e => e.processor.programKey())].join('+')
  return state
}

/** Подключить процессор к материалу. Единственный разрешённый способ влезть в шейдер материала. */
export function attachProcessor<T extends Material>(material: T, processor: MaterialProcessor): ProcessorHandle {
  if (!rank.has(processor.stage)) throw new Error(`Unknown material stage "${processor.stage}" (${processor.id})`)
  const state = install(material)
  const previous = state.processors.findIndex(e => e.processor.id === processor.id)
  if (previous >= 0) { if (state.processors[previous].processor.onFrame) framed--; state.processors.splice(previous, 1) }
  const entry = { processor, seq: sequence++ }
  state.processors.push(entry)
  if (processor.onFrame) framed++
  material.needsUpdate = true
  let attached = true
  return {
    detach() {
      if (!attached) return
      attached = false
      const index = state.processors.indexOf(entry)
      if (index < 0) return // уже заменён процессором с тем же id
      state.processors.splice(index, 1)
      if (processor.onFrame) framed--
      material.needsUpdate = true
    },
  }
}

/** Процессоры материала в порядке исполнения — для диагностики и тестов. */
export function materialProcessors(material: Material): readonly MaterialProcessor[] {
  const state = pools.get(material)
  return state ? sorted(state).map(e => e.processor) : []
}

/** Прогнать onFrame всех процессоров на видимых материалах дерева. Вызывает рендер-цикл (плеер). */
export function updateMaterialFrames(root: Object3D, frame: MaterialFrame): void {
  if (framed <= 0) return
  const seen = new Set<Material>()
  root.traverseVisible(object => {
    const material = (object as Object3D & { material?: Material | Material[] }).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      if (seen.has(m)) continue
      seen.add(m)
      const state = pools.get(m)
      if (state) for (const { processor } of sorted(state)) processor.onFrame?.(frame, m)
    }
  })
}

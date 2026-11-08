import * as THREE from 'three'
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three'
import { attachProcessor, type MaterialProcessor, type ProcessorHandle } from '../materials/materialPipeline.ts'
import { fetchVerified, importCode } from '../packages/packageCode.ts'
import type { SceneShadowLight, ShadowDeclaration, ShadowDescriptor, ShadowParamSpec } from '../../../contracts/shadow.ts'
export type { SceneShadowLight, ShadowDeclaration, ShadowDescriptor, ShadowParamSpec }

/* ─────────────────────────────────────────────────────────────────────────────
 * ГНЕЗДО ТЕНИ. Движок тень не содержит. Он говорит: «для показа нужна тень —
 * вставьте сюда пакет тени». Какую тень и с какими параметрами — решает ОБЪЕКТ
 * (manifest.render.shadow). Пакеты теней лежат отдельно: shadows/<id>/<rev>/.
 *
 * Граница (решение владельца, 8 ноя 2026):
 *   СЦЕНА (свет)  — НАПРАВЛЕНИЕ и ЧЁТКОСТЬ тени: позиция ключевого света, размер
 *                   источника (radius), размер карты теней (lightMapSize).
 *   ТЕНЬ (пакет)  — КАК тень выглядит: на полу (приёмник, плотность, цвет, контакт,
 *                   накопление) и на объекте (фильтр теней в материалах, через пул).
 *
 * Контракт: данные — app/contracts/shadow.schema.json, shadow-declaration.schema.json (+ типы contracts/shadow.ts);
 * код — интерфейсы ниже. Цепочка подключения — docs/architecture/contracts.md, правила — shadow.md.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SHADOW_API_VERSION = 1

/** Что движок даёт пакету тени. */
export interface ShadowContext {
  three: typeof THREE
  renderer: WebGLRenderer
  scene: Scene
  /** корень показываемого объекта: он отбрасывает тень */
  subject: Object3D
  light: SceneShadowLight
  /** параметры, проверенные по shadow.json и дополненные значениями по умолчанию */
  params: Record<string, unknown>
  /** подключить процессор к материалам объекта; стадия — 'lighting', id — 'shadow.<id>' */
  receivers: { use(processor: Omit<MaterialProcessor, 'stage'>): void }
}

/** Что пакет тени возвращает. */
export interface ShadowInstance {
  /** начать накопление заново (сменился объект/свет) */
  reset(): void
  /** шаг на кадр; true — тени нужен ещё кадр */
  update(frame: { camera: Camera }): boolean
  dispose(): void
}

/** export default модуля тени. */
export interface ShadowModule {
  apiVersion: typeof SHADOW_API_VERSION
  create(ctx: ShadowContext): ShadowInstance
}

/** Тень, загруженная и проверенная, готовая к вставке в гнездо. */
export interface PreparedShadow {
  key: string
  descriptor: ShadowDescriptor
  params: Record<string, unknown>
  module: ShadowModule
}

const KEY = /^([a-z0-9][a-z0-9-]{0,63})@([a-z0-9][a-z0-9._-]{0,63})$/
const SHA = /^[a-f0-9]{64}$/
const FILE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+\.m?js$/
const COLOR = /^#[0-9a-f]{6}$/i

/** Прочитать объявление тени из manifest.render. Строго: объект ОБЯЗАН сказать про тень. */
export function shadowDeclaration(render: Record<string, unknown>): ShadowDeclaration | null {
  if (!('shadow' in render)) throw new Error('Object does not declare render.shadow (use null for "no shadow")')
  const value = render.shadow as ShadowDeclaration | null
  if (value === null) return null
  if (!value || typeof value !== 'object' || typeof value.use !== 'string' || !KEY.test(value.use)) throw new Error('Invalid render.shadow: expected { use: "<id>@<rev>", params? }')
  if (value.params !== undefined && (typeof value.params !== 'object' || value.params === null || Array.isArray(value.params))) throw new Error('Invalid render.shadow.params')
  return value
}

/** Свет для тени из настроек СЦЕНЫ. Строго: без ключевого света тени не бывает. */
export function sceneShadowLight(settings: any): SceneShadowLight {
  const position = settings?.key?.position, radius = settings?.shadow?.radius, mapSize = settings?.shadow?.lightMapSize
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('Scene has no key light position for the shadow')
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Scene has no shadow light radius')
  if (!Number.isInteger(mapSize) || mapSize < 128) throw new Error('Scene has no shadow light map size')
  return { position: [position[0], position[1], position[2]], radius, mapSize }
}

export function validateShadowDescriptor(d: any, id: string, revision: string): asserts d is ShadowDescriptor {
  if (d?.schemaVersion !== 1 || d.id !== id || d.revision !== revision) throw new Error(`Shadow ${id}@${revision}: identity mismatch`)
  if (d.apiVersion !== SHADOW_API_VERSION) throw new Error(`Shadow ${id}@${revision}: API ${String(d.apiVersion)} is not supported (engine: ${SHADOW_API_VERSION})`)
  const e = d.entry
  if (!e || typeof e.file !== 'string' || !FILE.test(e.file) || !SHA.test(e.sha256) || !Number.isInteger(e.bytes) || e.bytes <= 0 || e.bytes > 512 * 1024) throw new Error(`Shadow ${id}@${revision}: invalid entry`)
  if (!d.params || typeof d.params !== 'object') throw new Error(`Shadow ${id}@${revision}: no params schema`)
}

/** Проверить параметры объекта по контракту тени и дополнить значениями по умолчанию. Строго. */
export function resolveShadowParams(schema: Record<string, ShadowParamSpec>, given: Record<string, unknown> = {}): Record<string, unknown> {
  for (const name of Object.keys(given)) if (!(name in schema)) throw new Error(`Shadow param "${name}" is not in the shadow contract`)
  const out: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(schema)) {
    const value = name in given ? given[name] : spec.default
    const bad = () => new Error(`Shadow param "${name}" is out of contract: ${JSON.stringify(value)}`)
    if (spec.type === 'number' || spec.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.type === 'integer' && !Number.isInteger(value))) throw bad()
    } else if (spec.type === 'color') {
      if (typeof value !== 'string' || !COLOR.test(value)) throw bad()
    } else if (spec.type === 'vector3') {
      if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && v >= spec.min && v <= spec.max)) throw bad()
    } else throw new Error(`Shadow param "${name}": unknown type`)
    out[name] = Array.isArray(value) ? [...value] : value
  }
  return out
}

/** Загрузить пакет тени по объявлению объекта. Строго: любая ошибка — ошибка показа объекта. */
export async function loadShadow(declaration: ShadowDeclaration, signal?: AbortSignal, baseUrl: string = location.href): Promise<PreparedShadow> {
  const [, id, revision] = KEY.exec(declaration.use)!
  const base = `/shadows/${id}/${revision}/`
  const res = await fetch(new URL(base + 'shadow.json', baseUrl), { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Shadow ${declaration.use}: HTTP ${res.status}`)
  const descriptor = await res.json()
  validateShadowDescriptor(descriptor, id, revision)
  const params = resolveShadowParams(descriptor.params, declaration.params)
  const code = await fetchVerified(new URL(base + descriptor.entry.file, baseUrl).href, descriptor.entry.sha256, descriptor.entry.bytes, signal)
  const module = await importCode<Partial<ShadowModule>>(code)
  if (!module || module.apiVersion !== SHADOW_API_VERSION || typeof module.create !== 'function') throw new Error(`Shadow ${declaration.use}: module does not implement shadow API ${SHADOW_API_VERSION}`)
  return { key: declaration.use, descriptor, params, module: module as ShadowModule }
}

/** Вставить тень в гнездо: движок даёт сцену, объект и свет; материалы объекта — только через пул. */
export function attachShadow(prepared: PreparedShadow, host: { renderer: WebGLRenderer; scene: Scene; subject: Object3D; light: SceneShadowLight }): ShadowInstance {
  const handles: ProcessorHandle[] = []
  const materials = () => {
    const set = new Set<Material>()
    host.subject.traverse(o => { const m = (o as Object3D & { material?: Material | Material[] }).material; if (m) for (const x of Array.isArray(m) ? m : [m]) set.add(x) })
    return set
  }
  const release = () => { while (handles.length) handles.pop()!.detach() }
  let instance: ShadowInstance
  try {
    instance = prepared.module.create({
      three: THREE,
      renderer: host.renderer,
      scene: host.scene,
      subject: host.subject,
      light: { ...host.light, position: [...host.light.position] as [number, number, number] },
      params: structuredClone(prepared.params),
      receivers: {
        use(processor) {
          for (const material of materials()) handles.push(attachProcessor(material, { ...processor, id: `shadow.${prepared.descriptor.id}.${processor.id}`, stage: 'lighting' }))
        },
      },
    })
    if (!instance || typeof instance.update !== 'function' || typeof instance.reset !== 'function' || typeof instance.dispose !== 'function') throw new Error(`Shadow ${prepared.key}: create() must return { reset, update, dispose }`)
  } catch (error) {
    release()
    throw error
  }
  let disposed = false
  return {
    reset: () => instance.reset(),
    update: frame => disposed ? false : instance.update(frame),
    dispose() { if (disposed) return; disposed = true; try { instance.dispose() } finally { release() } },
  }
}

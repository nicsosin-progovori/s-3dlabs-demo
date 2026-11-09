import * as THREE from 'three'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { fetchVerified, importCode } from '../packages/packageCode.ts'
import { SCENE_API_VERSION, type SceneProfile } from '../scenes/sceneContract.ts'

/* ─────────────────────────────────────────────────────────────────────────────
 * СЛОТ СЦЕНЫ. Сцена — данные (scene.json) и, если нужно, КОД (scene.json → code).
 * Данные интерпретирует встроенный адаптер плеера (components/Rig.tsx, Backdrop.tsx):
 * свет, окружение для отражений, фон, экспозиция. Код вставляется в этот слот ПОВЕРХ
 * адаптера — для того, что данными не выразить: постобработка (AO), циклорама,
 * свой тон-маппинг, сложный свет.
 *
 * Правила:
 *   • код грузится только после проверки размера и sha256 (packages/packageCode.ts);
 *   • сцена не знает, какой объект в ней стоит: объекта код НЕ получает (I-10 — позже);
 *   • всё, что код добавил в three-сцену/рендерер, он убирает в dispose();
 *   • ошибки строгие: код не загрузился / create() упал / update() упал — ошибка показа.
 * Смена сцены = dispose() старого кода, create() нового.
 * Контракт данных — app/contracts/scene.schema.json (code), правила — docs/architecture/04-scene.md.
 * ──────────────────────────────────────────────────────────────────────────── */

export { SCENE_API_VERSION }

/** Что плеер даёт коду сцены. */
export interface SceneContext {
  three: typeof THREE
  renderer: WebGLRenderer
  /** three-сцена кадра: сюда код может добавлять свои объекты (и убрать их в dispose) */
  scene: Scene
  /** проверенный профиль сцены (заморожен): settings, coordinates.worldScale, … */
  profile: SceneProfile
  /** code.params из scene.json (копия) */
  params: Record<string, unknown>
  /** размер области кадра, px */
  size: { width: number; height: number }
}

export interface SceneFrame { camera: Camera; size: { width: number; height: number }; delta: number }

/** Что код сцены возвращает. Все методы, кроме dispose, необязательны. */
export interface SceneInstance {
  /** шаг на кадр (до отрисовки); true — нужен ещё кадр */
  update?(frame: SceneFrame): boolean | void
  /** ЕСЛИ есть — код сам рисует кадр (постобработка: AO, свой тон-маппинг).
   *  Плеер тогда не рисует сам; код обязан отрисовать scene с camera. */
  render?(frame: SceneFrame): void
  /** изменился размер кадра */
  resize?(size: { width: number; height: number }): void
  dispose(): void
}

/** export default модуля сцены. */
export interface SceneModule {
  apiVersion: typeof SCENE_API_VERSION
  create(ctx: SceneContext): SceneInstance
}

/** Загрузить код сцены, если она его объявила. null — сцена только данными. Строго. */
export async function loadSceneCode(profile: SceneProfile, signal?: AbortSignal, baseUrl: string = location.href): Promise<SceneModule | null> {
  if (!profile.code) return null
  const key = `${profile.id}@${profile.revision}`
  const url = new URL(`/scenes/${profile.id}/${profile.revision}/${profile.code.entry.file}`, baseUrl).href
  const bytes = await fetchVerified(url, profile.code.entry.sha256, profile.code.entry.bytes, signal)
  const module = await importCode<Partial<SceneModule>>(bytes)
  return checkSceneModule(module, key)
}

/** Модуль реализует API слота? Строго. */
export function checkSceneModule(module: Partial<SceneModule> | undefined, key: string): SceneModule {
  if (!module || module.apiVersion !== SCENE_API_VERSION || typeof module.create !== 'function') throw new Error(`Scene ${key}: code does not implement scene API ${SCENE_API_VERSION}`)
  return module as SceneModule
}

/** Вставить код сцены в слот. Возвращает обёртку: после dispose вызовы — пустые. */
export function attachScene(module: SceneModule, host: { renderer: WebGLRenderer; scene: Scene; profile: SceneProfile; size: { width: number; height: number } }): SceneInstance & { renders: boolean } {
  const key = `${host.profile.id}@${host.profile.revision}`
  const instance = module.create({
    three: THREE,
    renderer: host.renderer,
    scene: host.scene,
    profile: host.profile,
    params: structuredClone(host.profile.code?.params ?? {}),
    size: { ...host.size },
  })
  if (!instance || typeof instance.dispose !== 'function') throw new Error(`Scene ${key}: create() must return { dispose, update?, render?, resize? }`)
  for (const name of ['update', 'render', 'resize'] as const)
    if (instance[name] !== undefined && typeof instance[name] !== 'function') throw new Error(`Scene ${key}: ${name} must be a function`)
  let disposed = false
  return {
    renders: typeof instance.render === 'function',
    update: frame => disposed ? false : instance.update?.(frame),
    render: frame => { if (!disposed) instance.render?.(frame) },
    resize: size => { if (!disposed) instance.resize?.(size) },
    dispose() { if (disposed) return; disposed = true; instance.dispose() },
  }
}

import type { ObjectUnits, SceneCode, SceneDeclaration, SceneProfile, SceneSettings, Vec3 } from '../../../contracts/scene.ts'
export type { ObjectUnits, SceneCode, SceneDeclaration, SceneProfile, SceneSettings }

/* ─────────────────────────────────────────────────────────────────────────────
 * КОНТРАКТ СЦЕНЫ в плеере. Сцена — отдельная сущность: scenes/<id>/<rev>/scene.json.
 * Объект выбирает сцены (manifest.render.scenes, порядок = приоритет), плеер берёт первую.
 * Сцена не перестраивается под объект: объект сообщает свои единицы (render.units ×
 * render.scale → метры), сцена — свои (coordinates.worldScale, единиц на метр);
 * движок масштабирует объект на произведение.
 *
 * Проверки — те же, что у старой студии (shared/sceneContract.mjs), кроме:
 *   • worldScale — свойство сцены (любое > 0), а не константа 12;
 *   • разрешены "$schema" и "label";
 *   • необязательный "code" — код сцены для слота (sockets/sceneSocket.ts).
 * Данные — app/contracts/scene.schema.json (+ типы contracts/scene.ts).
 * Ошибки строгие: сцена не прошла — показ невозможен.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SCENE_SCHEMA = 1
export const SCENE_ENGINE = 'source-studio-v01'
export const SCENE_MAX_BYTES = 64 * 1024
export const SCENE_API_VERSION = 1
export const SCENE_CODE_MAX_BYTES = 512 * 1024

const KEY = /^([a-z0-9][a-z0-9-]{0,63})@([a-z0-9][a-z0-9._-]{0,63})$/
const COLOR = /^#[a-fA-F0-9]{6}$/
const SHA = /^[a-f0-9]{64}$/
const CODE_FILE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+\.m?js$/
const RESOLUTIONS = [128, 256, 512, 1024, 2048, 4096]

export interface SceneRef { id: string; revision: string }

/** "<id>@<rev>" → { id, revision }. Строго. */
export function parseSceneKey(key: string): SceneRef {
  const m = typeof key === 'string' ? KEY.exec(key) : null
  if (!m) throw new Error(`Invalid scene key "${String(key)}": expected "<id>@<rev>"`)
  return { id: m[1], revision: m[2] }
}

/** Прочитать выбор сцен из manifest.render. Строго: объект ОБЯЗАН назвать хотя бы одну сцену. */
export function sceneDeclaration(render: Record<string, unknown>): SceneDeclaration {
  const value = render.scenes
  if (!Array.isArray(value) || value.length === 0) throw new Error('Object does not declare render.scenes (expected ["<id>@<rev>", …])')
  for (const key of value) parseSceneKey(key as string)
  if (new Set(value).size !== value.length) throw new Error('render.scenes has duplicates')
  return [...value] as SceneDeclaration
}

const UNITS: Record<ObjectUnits, number> = { metres: 1, centimetres: 0.01, millimetres: 0.001 }

/** Во сколько раз умножить геометрию объекта, чтобы получить метры: единицы × поправка.
 *  render.units обязателен; render.scale (поправка «модель чуть не того размера») — по умолчанию 1. */
export function objectToMetres(render: Record<string, unknown>): number {
  const units = render.units as ObjectUnits
  if (!(units in UNITS)) throw new Error(`Object render.units must be one of ${Object.keys(UNITS).join(', ')} (got ${JSON.stringify(units)})`)
  const scale = render.scale ?? 1
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1000) throw new Error(`Object render.scale must be a positive number (got ${JSON.stringify(scale)})`)
  return UNITS[units] * scale
}

/* ── проверка профиля ─────────────────────────────────────────────────────── */

const fail = (what: string) => new Error('Invalid scene ' + what)
function obj(v: any, name: string, keys: string[], optional: string[] = []): any {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(name)
  for (const k of keys) if (!(k in v)) throw fail(name + ': missing ' + k)
  for (const k of Object.keys(v)) if (!keys.includes(k) && !optional.includes(k)) throw fail(name + ': unknown ' + k)
  return v
}
function num(v: any, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw fail(name)
  return v
}
function int(v: any, name: string, min: number, max: number): number { num(v, name, min, max); if (!Number.isInteger(v)) throw fail(name); return v }
function vec(v: any, name: string, min = -50, max = 50): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw fail(name)
  return v.map(n => num(n, name, min, max)) as Vec3
}
function color(v: any, name: string): string { if (typeof v !== 'string' || !COLOR.test(v)) throw fail(name + ' color'); return v.toLowerCase() }
function res(v: any, name: string, max = 4096): number { if (!RESOLUTIONS.includes(v) || v > max) throw fail(name + ' resolution'); return v }
function light(v: any, name: string) {
  obj(v, name, ['position', 'target', 'color', 'intensity'])
  return { position: vec(v.position, name + ' position'), target: vec(v.target, name + ' target'), color: color(v.color, name), intensity: num(v.intensity, name + ' intensity', 0, 20) }
}
function code(v: any): SceneCode {
  obj(v, 'code', ['apiVersion', 'entry'], ['params'])
  if (v.apiVersion !== SCENE_API_VERSION) throw new Error(`Scene code API ${String(v.apiVersion)} is not supported (player: ${SCENE_API_VERSION})`)
  const e = obj(v.entry, 'code entry', ['file', 'sha256', 'bytes'])
  if (typeof e.file !== 'string' || !CODE_FILE.test(e.file) || typeof e.sha256 !== 'string' || !SHA.test(e.sha256) || !Number.isInteger(e.bytes) || e.bytes <= 0 || e.bytes > SCENE_CODE_MAX_BYTES) throw fail('code entry')
  if (v.params !== undefined && (!v.params || typeof v.params !== 'object' || Array.isArray(v.params))) throw fail('code params')
  return { apiVersion: SCENE_API_VERSION, entry: { file: e.file, sha256: e.sha256, bytes: e.bytes }, ...(v.params ? { params: structuredClone(v.params) } : {}) }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Проверить scene.json и вернуть замороженный профиль. expected — какую сцену просили (папка). */
export function validateSceneProfile(value: any, expected?: SceneRef): SceneProfile {
  obj(value, 'profile', ['schemaVersion', 'id', 'revision', 'engine', 'coordinates', 'settings'], ['$schema', 'label', 'code'])
  if (value.schemaVersion !== SCENE_SCHEMA) throw fail('schemaVersion')
  if (value.engine !== SCENE_ENGINE) throw new Error(`Scene engine "${String(value.engine)}" is not supported (player: ${SCENE_ENGINE})`)
  const ref = parseSceneKey(`${value.id}@${value.revision}`)
  if (expected && (ref.id !== expected.id || ref.revision !== expected.revision)) throw new Error(`Scene ${expected.id}@${expected.revision}: identity mismatch`)
  let label: Record<string, string> | undefined
  if (value.label !== undefined) {
    if (!value.label || typeof value.label !== 'object' || Array.isArray(value.label) || Object.values(value.label).some(x => typeof x !== 'string')) throw fail('label')
    label = { ...value.label }
  }
  const c = obj(value.coordinates, 'coordinates', ['modelUnits', 'worldScale', 'up', 'groundY', 'front'])
  if (c.modelUnits !== 'metres' || c.up !== 'Y' || c.groundY !== 0 || c.front !== '+Z') throw new Error('Incompatible scene coordinates (expected metres, Y up, ground 0, front +Z)')
  if (typeof c.worldScale !== 'number' || !Number.isFinite(c.worldScale) || c.worldScale <= 0 || c.worldScale > 1000) throw fail('worldScale')

  const s = obj(value.settings, 'settings', ['exposure', 'toneMapping', 'shadowType', 'background', 'ambient', 'hemisphere', 'key', 'fill', 'environment', 'shadow', 'shadowMap', 'ao', 'revealMs'])
  if (s.toneMapping !== 'aces-filmic' || s.shadowType !== 'basic') throw new Error('Unsupported scene color/shadow pipeline')
  const bg = obj(s.background, 'background', ['top', 'bottom'])
  const hemi = obj(s.hemisphere, 'hemisphere', ['intensity', 'sky', 'ground'])
  const env = obj(s.environment, 'environment', ['resolution', 'intensity', 'surround', 'boxes'])
  if (!Array.isArray(env.boxes) || env.boxes.length < 1 || env.boxes.length > 12) throw fail('softboxes')
  const sh = obj(s.shadow, 'shadow', ['radius', 'contact', 'opacity', 'density', 'frames', 'resolution', 'position', 'color', 'scale', 'compositionScale', 'areaSamples', 'contactSamples', 'lightMapSize'])
  const map = obj(s.shadowMap, 'shadow maps', ['productResolution', 'groundResolution', 'bias', 'normalBias'])
  const ao = obj(s.ao, 'ambient occlusion', ['resolutionScale', 'intensity', 'radius', 'thickness', 'samples'])
  const settings: SceneSettings = {
    exposure: num(s.exposure, 'exposure', 0.1, 4), toneMapping: 'aces-filmic', shadowType: 'basic',
    background: { top: color(bg.top, 'background top'), bottom: color(bg.bottom, 'background bottom') },
    ambient: num(s.ambient, 'ambient light', 0, 5),
    hemisphere: { intensity: num(hemi.intensity, 'hemisphere intensity', 0, 5), sky: color(hemi.sky, 'hemisphere sky'), ground: color(hemi.ground, 'hemisphere ground') },
    key: light(s.key, 'key light'), fill: light(s.fill, 'fill light'),
    environment: {
      resolution: res(env.resolution, 'environment', 1024), intensity: num(env.intensity, 'environment intensity', 0, 5), surround: color(env.surround, 'surround'),
      boxes: env.boxes.map((b: any) => {
        obj(b, 'softbox', ['position', 'scale', 'intensity', 'color'])
        if (!Array.isArray(b.scale) || b.scale.length !== 2) throw fail('softbox scale')
        return { position: vec(b.position, 'softbox position'), scale: b.scale.map((n: any) => num(n, 'softbox scale', 0.01, 30)) as [number, number], intensity: num(b.intensity, 'softbox intensity', 0, 20), color: color(b.color, 'softbox') }
      }),
    },
    shadow: {
      radius: num(sh.radius, 'shadow radius', 0, 10), contact: num(sh.contact, 'shadow contact', 0, 1), opacity: num(sh.opacity, 'shadow opacity', 0, 1),
      density: num(sh.density, 'shadow density', 0, 4), frames: int(sh.frames, 'shadow frames', 1, 128), resolution: res(sh.resolution, 'shadow', 2048),
      position: vec(sh.position, 'shadow receiver', -30, 30), color: color(sh.color, 'shadow'), scale: num(sh.scale, 'shadow scale', 4, 40),
      compositionScale: num(sh.compositionScale, 'composition shadow scale', 4, 40), areaSamples: int(sh.areaSamples, 'area light samples', 1, 8),
      contactSamples: int(sh.contactSamples, 'contact light samples', 1, 4), lightMapSize: res(sh.lightMapSize, 'shadow light map', 1024),
    },
    shadowMap: { productResolution: res(map.productResolution, 'product shadow map'), groundResolution: res(map.groundResolution, 'ground shadow map'), bias: num(map.bias, 'shadow bias', -0.01, 0.01), normalBias: num(map.normalBias, 'shadow normal bias', 0, 0.1) },
    ao: { resolutionScale: num(ao.resolutionScale, 'AO resolution', 0.5, 1), intensity: num(ao.intensity, 'AO intensity', 0, 2), radius: num(ao.radius, 'AO radius', 0.001, 2), thickness: num(ao.thickness, 'AO thickness', 0.001, 1), samples: int(ao.samples, 'AO samples', 1, 32) },
    revealMs: int(s.revealMs, 'reveal duration', 0, 1000),
  }
  if (Math.abs(settings.shadow.position[1] - 0.002) > 0.000001) throw new Error('Incompatible shadow receiver height')
  return freeze({
    schemaVersion: SCENE_SCHEMA, id: ref.id, revision: ref.revision, ...(label ? { label } : {}), engine: SCENE_ENGINE,
    ...(value.code !== undefined ? { code: code(value.code) } : {}),
    coordinates: { modelUnits: 'metres', worldScale: c.worldScale, up: 'Y', groundY: 0, front: '+Z' },
    settings,
  })
}

/** Значение по пути "a.b" в настройках сцены (для needsFromScene тени). undefined — нет. */
export function sceneValue(settings: SceneSettings, path: string): unknown {
  let v: any = settings
  for (const part of path.split('.')) { if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined; v = v[part] }
  return v
}

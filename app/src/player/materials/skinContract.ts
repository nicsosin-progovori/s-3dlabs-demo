/* Проверки скина ПО ОБЪЕКТУ (issue #1). Глобального реестра скинов в плеере нет:
 * что принимает объект, объявляет сам объект (manifest.render.skin), скин сверяется с ним.
 * Без three и сети — используется и плеером, и тестами контрактов. */
import type { ObjectSkinSurface, SkinCompatibility, SkinManifest, SkinRef } from '../../../contracts/skin.ts'
import { validateEnhancementRef } from './skinEnhancement.ts'

const KEY = /^([a-z0-9][a-z0-9-]{0,63})@([a-z0-9][a-z0-9._-]{0,63})$/
const DIR = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/
/** Расширения glTF-материалов, которые умеет собирать загрузчик плеера (возможность движка, не объекта). */
export const SUPPORTED_MATERIAL_EXTENSIONS = ['KHR_materials_clearcoat', 'KHR_materials_anisotropy'] as const

/** "<id>@<rev>" → SkinRef. Строго. */
export function parseSkinKey(key: string): SkinRef {
  const m = KEY.exec(String(key))
  if (!m) throw new Error(`Invalid skin key "${key}"`)
  return { id: m[1], revision: m[2] }
}

function isCompatibility(value: unknown): value is SkinCompatibility {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 &&
    Object.values(value).every(v => typeof v === 'string' && v.length > 0)
}

/** Совпадает ли совместимость целиком (те же ключи, те же значения). */
export function sameCompatibility(a: unknown, b: SkinCompatibility): boolean {
  if (!isCompatibility(a)) return false
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/** manifest.render.skin. undefined — у объекта нет скинов (только «родные» материалы GLB). */
export function skinSurface(render: Record<string, unknown>): ObjectSkinSurface | null {
  if (!('skin' in render)) return null
  const s = render.skin as Partial<ObjectSkinSurface> | null
  if (!s || typeof s !== 'object') throw new Error('Invalid render.skin')
  if (!isCompatibility(s.compatibility)) throw new Error('render.skin.compatibility must be a non-empty set of strings')
  if (!Array.isArray(s.slots) || s.slots.length === 0 || s.slots.some(v => typeof v !== 'string' || !v) || new Set(s.slots).size !== s.slots.length) throw new Error('render.skin.slots must be unique non-empty strings')
  if (typeof s.default !== 'string') throw new Error('render.skin.default is required')
  parseSkinKey(s.default)
  if (typeof s.dir !== 'string' || !DIR.test(s.dir)) throw new Error('Invalid render.skin.dir')
  return { compatibility: { ...s.compatibility }, slots: [...s.slots], default: s.default, dir: s.dir }
}

/** Путь skin.json в пакете объекта. */
export function skinFile(surface: ObjectSkinSurface, ref: SkinRef): string {
  return `${surface.dir}/${ref.id}/${ref.revision}/skin.json`
}

/** skin.json против объекта: та же совместимость, слоты — ровно слоты объекта, все закрыты. */
export function validateSkinManifest(manifest: SkinManifest, ref: SkinRef, surface: ObjectSkinSurface): void {
  const name = `${ref.id}@${ref.revision}`
  if (manifest?.schemaVersion !== 1 || manifest.id !== ref.id || manifest.revision !== ref.revision) throw new Error(`Skin ${name}: identity mismatch`)
  if (!sameCompatibility(manifest.compatibility, surface.compatibility)) throw new Error(`Skin ${name} is not compatible with this object`)
  if (!Array.isArray(manifest.materials) || manifest.materials.length === 0) throw new Error(`Skin ${name}: no materials`)
  const allowed = new Set(surface.slots), seen = new Set<string>()
  for (const m of manifest.materials) {
    const slot = m?.extras?.materialSlotId
    if (!slot || seen.has(slot)) throw new Error(`Skin ${name}: duplicate or missing material slot`)
    if (!allowed.has(slot)) throw new Error(`Skin ${name}: slot "${slot}" is not declared by the object`)
    seen.add(slot)
    if (Object.keys(m.extensions ?? {}).some(k => !(SUPPORTED_MATERIAL_EXTENSIONS as readonly string[]).includes(k))) throw new Error(`Skin ${name}: unsupported material extension`)
  }
  const missing = surface.slots.filter(s => !seen.has(s))
  if (missing.length) throw new Error(`Skin ${name}: base skin does not cover slots ${missing.join(', ')}`)
  if (manifest.enhancement !== undefined) validateEnhancementRef(manifest.enhancement)
  if (!manifest.profiles || typeof manifest.profiles !== 'object' || !manifest.profiles.low || !manifest.profiles.final) throw new Error(`Skin ${name}: profiles low and final are required`)
  for (const profile of Object.values(manifest.profiles)) {
    if (!Array.isArray(profile.images) || profile.images.length > 32) throw new Error(`Skin ${name}: invalid texture profile`)
    for (const im of profile.images) if (!/^[a-f0-9]{64}$/.test(im.sha256) || im.file !== 'textures/' + im.sha256 + '.png' || im.mimeType !== 'image/png' || im.bytes <= 0 || im.bytes > 2 * 1024 * 1024 || im.width < 1 || im.height < 1 || im.width > 2048 || im.height > 2048) throw new Error(`Skin ${name}: invalid image`)
  }
}

/** Геометрия против объекта: если GLB сам объявляет совместимость (extras сцены), она обязана совпасть. */
export function validateGeometrySkinSurface(declared: unknown, surface: ObjectSkinSurface): void {
  if (declared !== undefined && !sameCompatibility(declared, surface.compatibility)) throw new Error('Geometry skin compatibility does not match render.skin')
}

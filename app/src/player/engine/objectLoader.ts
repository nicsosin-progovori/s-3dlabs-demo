/** GENERIC-загрузчик: знает только манифест и как резолвить ссылки.
 *  Никаких знаний о конкретном объекте здесь нет — интерпретацией занимается
 *  единый движок engine/objectEngine.ts, читая данные из manifest.render. */
export interface ManifestPart { file: string; bytes: number; sha256: string }
export interface ObjectRender {
  adapter?: string
  geometry?: { final?: string; low?: string }
  states?: string[]
  defaultState?: string
  /** поверхность скина объекта — app/contracts/skin-surface.schema.json */
  skin?: import('../../../contracts/skin.ts').ObjectSkinSurface
  /** в каких единицах сделан объект; плеер переводит в метры */
  units?: import('../../../contracts/scene.ts').ObjectUnits
  /** поправка к масштабу («модель чуть не того размера»), по умолчанию 1 */
  scale?: number
  /** сцены, в которых объект хочет рендериться, "<id>@<rev>"; порядок — приоритет (scene-declaration.schema.json) */
  scenes?: import('../../../contracts/scene.ts').SceneDeclaration
  camera?: string
}
export interface ObjectManifest {
  schemaVersion: number
  id: string
  revision: string
  label?: Record<string, string>
  render?: ObjectRender
  parts: Record<string, ManifestPart[]>
}
export interface LoadedObject { manifest: ObjectManifest; base: string }

export async function loadObjectManifest(id: string, revision: string, baseUrl: string = location.href): Promise<LoadedObject> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(revision)) throw new Error('Invalid object key')
  const base = `/objects/${id}/${revision}/`
  const res = await fetch(new URL(base + 'manifest.json', baseUrl), { cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Object manifest HTTP ' + res.status)
  const manifest = await res.json() as ObjectManifest
  if (manifest.id !== id || manifest.revision !== revision) throw new Error('Object identity mismatch')
  if (!manifest.parts || typeof manifest.parts !== 'object') throw new Error('Object manifest has no parts')
  return { manifest, base }
}
export function partUrl(base: string, file: string, baseUrl: string = location.href): string {
  return new URL(base + file, baseUrl).href
}

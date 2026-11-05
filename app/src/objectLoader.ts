/** Движок берёт объект по ключу id@revision из внешнего хранилища objects/.
 *  Никаких compile-time импортов — только рантайм-чтение манифеста и ссылок. */
export interface ManifestPart { file: string; bytes: number; sha256: string }
export interface ObjectRender {
  adapter?: string
  geometry?: { final?: string; low?: string }
  states?: string[]
  defaultState?: string
  defaultSkin?: string
  skinsDir?: string
  scene?: string
  camera?: string
  compatibility?: Record<string, string>
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
/** Выбор основного GLB объекта: мастер `<id>.glb`, иначе первый .glb. */
export function pickGeometryUrl(o: LoadedObject): string {
  const final = o.manifest.render?.geometry?.final
  if (final) return partUrl(o.base, final)
  const geo = o.manifest.parts.geometry ?? []
  const master = geo.find(f => f.file.endsWith('/' + o.manifest.id + '.glb')) ?? geo.find(f => f.file.endsWith('.glb'))
  if (!master) throw new Error('Object has no geometry GLB')
  return partUrl(o.base, master.file)
}

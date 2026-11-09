import { SCENE_MAX_BYTES, parseSceneKey, validateSceneProfile, type SceneProfile } from './sceneContract.ts'

/** Загрузить сцену "<id>@<rev>" из scenes/<id>/<rev>/scene.json (сервер: /scenes/).
 *  Строго: нет файла, слишком большой, не прошёл контракт, чужая identity — ошибка. */
export async function loadScene(key: string, signal?: AbortSignal, baseUrl: string = location.href): Promise<SceneProfile> {
  const ref = parseSceneKey(key)
  const res = await fetch(new URL(`/scenes/${ref.id}/${ref.revision}/scene.json`, baseUrl), { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Scene ${key}: HTTP ${res.status}`)
  const text = await res.text()
  if (new TextEncoder().encode(text).byteLength > SCENE_MAX_BYTES) throw new Error(`Scene ${key}: larger than ${SCENE_MAX_BYTES} bytes`)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error(`Scene ${key}: broken JSON`) }
  try { return validateSceneProfile(value, ref) }
  catch (e) { throw new Error(`Scene ${key}: ${(e as Error).message}`) }
}

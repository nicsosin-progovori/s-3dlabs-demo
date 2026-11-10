import { SCENE_MAX_BYTES, parseSceneKey, validateSceneProfile, type SceneProfile } from './sceneContract.ts'
import { loadSceneCode, type SceneModule } from '../sockets/sceneSocket.ts'

/** Сцена, готовая к показу: проверенный профиль + код для слота (если сцена его привезла). */
export interface LoadedScene {
  key: string
  profile: SceneProfile
  /** null — сцена только данными */
  code: SceneModule | null
}

/** Загрузить сцену "<id>@<rev>" из scenes/<id>/<rev>/scene.json (сервер: /scenes/) и её код.
 *  Строго: нет файла, слишком большой, не прошёл контракт, чужая identity, код не сошёлся — ошибка. */
export async function loadScene(key: string, signal?: AbortSignal, baseUrl: string = location.href): Promise<LoadedScene> {
  const ref = parseSceneKey(key)
  const res = await fetch(new URL(`/scenes/${ref.id}/${ref.revision}/scene.json`, baseUrl), { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Scene ${key}: HTTP ${res.status}`)
  const text = await res.text()
  if (new TextEncoder().encode(text).byteLength > SCENE_MAX_BYTES) throw new Error(`Scene ${key}: larger than ${SCENE_MAX_BYTES} bytes`)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error(`Scene ${key}: broken JSON`) }
  try {
    const profile = validateSceneProfile(value, ref)
    return { key, profile, code: await loadSceneCode(profile, signal, baseUrl) }
  } catch (e) { throw new Error(`Scene ${key}: ${(e as Error).message}`) }
}

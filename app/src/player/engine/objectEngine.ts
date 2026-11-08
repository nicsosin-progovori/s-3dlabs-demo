import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { LoadedObject } from './objectLoader'
import { partUrl } from './objectLoader'
import { loadSkin, bindSkin, type SkinBinding, type SkinBundle } from '../materials/skinLoader'
import { loadShadow, sceneShadowLight, shadowDeclaration, type PreparedShadow, type SceneShadowLight } from '../sockets/shadowSocket'
import { compositionFrame } from '../../compositionCamera'
import { validateSceneProfile } from '../../../shared/sceneContract.mjs'
import { validateCameraViews } from '../../../shared/cameraViewsContract.mjs'

/* ═══════════════════════════════════════════════════════════════════════════
 * КАРТА ЗОН ОТВЕТСТВЕННОСТИ (грепай по "ЗО[")
 *   ЗО[ОБЪЕКТ]      — данные/знание, которые привозит сам объект (objects/<id>/).
 *   ЗО[ОБЩЕЕ]       — общая математика/правило, одинаковое для любого объекта.
 *   ЗО[ПОЛИТИКА]    — выбор, который СЕЙЧАС зашит в приложение (качество, LOD,
 *                     дефолты). Кандидат вынести в настройку/объект/студию.
 *   ЗО[СТУДИЯ?]     — похоже на «показ/оформление» — возможный отдельный слой
 *                     «студия/клиент», не объект и не общий движок.
 *   ЗО[ВОПРОС]      — граница не решена: кто за это отвечает — решаешь ты.
 * Это пометки для разбора, НЕ финальная архитектура. Поведение не меняем.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BuiltObject {
  root: Group
  scene: any | null
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number; roll: number; near: number; far: number }
  shadowScale: number
  /** живая привязка скина — через неё меняем скин без перезагрузки геометрии */
  skin: SkinBinding | null
  skinKey: string | null
  /** тень, которую выбрал объект (пакет из shadows/), и свет сцены для неё; null — объект явно без тени */
  shadow: { prepared: PreparedShadow; light: SceneShadowLight } | null
  note: string
}

/** Скин "<id>@<rev>" из пакета объекта. Строго: нет в пакете — ошибка.
 *  ЗО[ОБЪЕКТ/КОНВЕНЦИЯ]: путь skins/<id>/<rev>/skin.json. ЗО[ПОЛИТИКА]: качество 'final', приоритет 'high'. */
export async function loadSkinBundle(o: LoadedObject, skinKey: string, signal: AbortSignal): Promise<SkinBundle> {
  const r: any = o.manifest.render ?? {}
  const [sid, srev] = String(skinKey).split('@')
  if (!sid || !srev) throw new Error(`Invalid skin key "${skinKey}"`)
  const file = `${r.skinsDir ?? 'skins'}/${sid}/${srev}/skin.json`
  const entry = (o.manifest.parts.skins ?? []).find((f: any) => f.file === file)
  if (!entry) throw new Error(`Skin ${skinKey} is not in object ${o.manifest.id}@${o.manifest.revision}`)
  return loadSkin({ id: sid, revision: srev }, 'final', signal, 'high', { basePath: o.base, descriptor: { file: entry.file, sha256: entry.sha256, bytes: entry.bytes } })
}

async function fetchJson(base: string, ref: string) {
  const r = await fetch(partUrl(base, ref), { cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ref)
  return r.json()
}

/** ЕДИНЫЙ generic-движок. Читает только manifest.render.*, применяет общие правила.
 *  Кода «про конкретный объект» здесь нет — но решений о границах пока много (см. ЗО[...]). */
export async function buildFromManifest(o: LoadedObject, signal: AbortSignal, viewport?: { width: number; height: number }, skinKey?: string): Promise<BuiltObject> {
  const r: any = o.manifest.render ?? {}

  // ЗО[ВОПРОС]: какое состояние показываем по умолчанию? Сейчас берёт объект (defaultState),
  // иначе — первое из границ, иначе 'default'. Выбор состояния — это объект, студия или UI плеера?
  const state: string = r.defaultState ?? Object.keys(r.frame?.boundsByState ?? {})[0] ?? 'default'

  // ЗО[ОБЪЕКТ]: какую геометрию грузить, объявляет объект (render.geometry).
  // ЗО[ПОЛИТИКА]: но ВЫБОР LOD зашит в движок — всегда .final. Кто решает final/low/hq:
  //   объект (дефолт), плеер (качество/сеть), или студия? Пока — плеер молча берёт final.
  const geoRef: string | undefined = r.geometry?.final ?? (o.manifest.parts.geometry ?? []).find((f: any) => f.file.endsWith('.glb'))?.file
  if (!geoRef) throw new Error('В объекте нет геометрии')
  const gltf = await new GLTFLoader().loadAsync(partUrl(o.base, geoRef))
  const root: Group = gltf.scene

  // ЗО[ОБЩЕЕ]: правило «спрятать меши по флагам» — общее; СПИСОК флагов везёт объект (render.hide).
  const hide: string[] = r.hide ?? []
  if (hide.length) root.traverse(x => { if (hide.some(flag => (x as any).userData?.[flag])) x.visible = false })
  // ЗО[ОБЩЕЕ]: меши объекта кастуют/принимают тени — общее правило рендера (нужно студийным теням).
  root.traverse(x => { const m = x as any; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  // ЗО[ОБЪЕКТ]: совместимость скина — данные объекта, движок только прокидывает в userData.
  if (r.compatibility) root.userData.skinCompatibility = r.compatibility

  // ЗО[ОБЪЕКТ]: скин задаёт вызывающий (SKU); если не задан — дефолт объекта (render.defaultSkin).
  // Строго: скин не загрузился/не подошёл — ошибка всей сборки, без «геометрии без скина».
  let note = 'геометрия'
  const useSkin: string | null = skinKey ?? r.defaultSkin ?? null
  let skin: SkinBinding | null = null
  if (useSkin) {
    skin = bindSkin({ root }, await loadSkinBundle(o, useSkin, signal))
    note = 'скин ' + useSkin
  }

  // ЗО[ОБЪЕКТ]: сцена/свет/тени/окружение — данные объекта (render.scene → контракт сцены).
  // ЗО[СТУДИЯ?]: но «как объект показывается» (свет, тени, задник) — кандидат в отдельный слой
  //   «студия/клиент». Сейчас это физически лежит в пакете объекта. Твоё решение: часть объекта
  //   или сменная студия поверх объекта?
  // ЗО[ВОПРОС]: worldScale (перевод модели в мир) берём из сцены объекта. Это свойство объекта,
  //   студии или общего мира сцены? Сейчас — объект (через сцену).
  let scene: any = null, worldScale = 1
  if (r.scene) {
    try { const prof: any = validateSceneProfile(await fetchJson(o.base, r.scene)); scene = prof.settings; worldScale = prof.coordinates?.worldScale ?? 1; note += ' + сцена' }
    catch (e) { note += ' (сцена: ' + ((e as Error)?.message ?? e) + ')' }
  }

  // ЗО[ОБЪЕКТ]: тень выбирает объект (render.shadow → пакет из shadows/). Движок тень не содержит.
  // ЗО[ГРАНИЦА]: направление и чёткость тени — от света СЦЕНЫ; вид тени — от пакета тени.
  // Строго: объект обязан объявить тень (или null); пакет/параметры/свет не сошлись — ошибка сборки.
  const shadowDecl = shadowDeclaration(r)
  let shadow: BuiltObject['shadow'] = null
  if (shadowDecl) {
    const light = sceneShadowLight(scene)
    shadow = { prepared: await loadShadow(shadowDecl, signal), light }
    note += ' + тень ' + shadowDecl.use
  }

  // ЗО[ОБЪЕКТ]: ПАРАМЕТРЫ ракурсов (azimuth/elevation/fov/roll/subject/margin) везёт объект (render.camera).
  // ЗО[ПОЛИТИКА]: ВЫБОР конкретного вида (defaultView / первый) делает движок.
  // ЗО[ВОПРОС]: это и есть твой главный вопрос — «просчёт камеры» чей? Сейчас так:
  //   объект даёт ЦИФРЫ ракурса, а МАТЕМАТИКУ кадра (ниже) считает движок одинаково для всех.
  //   Варианты: единый просчёт в плеере (как сейчас) / объект считает сам / разные просчёты по студии/клиенту.
  let view: any = null
  if (r.camera) {
    try {
      const cat: any = validateCameraViews(await fetchJson(o.base, r.camera))
      const s = cat.states?.[state]
      view = (s?.views?.find((v: any) => v.id === s.defaultView) ?? s?.views?.[0])?.camera ?? null
    } catch { /* камера некритична */ }
  }

  // ЗО[ОБЩЕЕ]: масштаб в мир — равномерный setScalar(worldScale). Ось не вращаем: движок
  //   ПРЕДПОЛАГАЕТ, что геометрия уже в системе движка (Y вверх, +Z вперёд) — это объект
  //   декларирует в render.frame.up/front, но движок это НЕ проверяет и НЕ доворачивает.
  //   ЗО[ВОПРОС]: если объект приедет с другой осью (напр. Z вверх), сейчас будет криво.
  //   Кто приводит объект к системе движка — подготовка объекта или движок по данным frame?
  root.scale.setScalar(worldScale)
  root.updateMatrixWorld(true)

  // ЗО[ОБЪЕКТ]: границы кадра объект привозит сам (frame.boundsByState, уже в метрах/системе движка).
  // ЗО[ОБЪЕКТ]: пол объявлен объектом (frame.floor==='Y0') → не приземляем. Иначе — приземляем (общий фолбэк).
  // ЗО[ОБЩЕЕ]: приземление/фолбэк по bbox — общее правило.
  const declared = r.frame?.boundsByState?.[state]
  let box: Box3
  if (declared?.min && declared?.max) {
    box = new Box3(new Vector3(...declared.min).multiplyScalar(worldScale), new Vector3(...declared.max).multiplyScalar(worldScale))
    if (r.frame?.floor !== 'Y0') { const g = new Box3().setFromObject(root); root.position.y += box.min.y - g.min.y; root.updateMatrixWorld(true) }
  } else {
    const g = new Box3().setFromObject(root); root.position.y -= g.min.y; root.updateMatrixWorld(true)
    box = new Box3().setFromObject(root)
  }

  // ЗО[ОБЩЕЕ]: compositionFrame — общая математика кадра (одинаковая для всех объектов).
  // ЗО[ПОЛИТИКА]: дефолты, когда у объекта НЕТ камеры (az 24, el 0.3, fov 28, margin 1.12) — выбор плеера.
  // ЗО[ОБЩЕЕ]: аспект берём из окна (runtime плеера), subject/zoom — из данных объекта.
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 3
  // ЗО[ОБЩЕЕ]: аспект — размер области плеера (передаёт плеер); фолбэк — окно.
  const vw = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1440)
  const vh = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 1000)
  const f = compositionFrame(box, view?.azimuth ?? 24, view?.elevation ?? 0.3, vw, vh, {
    fov: view?.fov ?? 28, roll: view?.roll ?? 0, margin: view?.margin ?? 1.12, subject: view?.subject ?? [0, 0], zoom: view?.zoom ?? 1,
  })
  return {
    root, scene,
    camera: {
      position: f.position.toArray() as [number, number, number],
      target: f.target.toArray() as [number, number, number],
      fov: f.fov, roll: f.roll ?? 0,
      // ЗО[ОБЪЕКТ]: near/far объект объявляет в ракурсе; дефолт (0.025/100) — ЗО[ПОЛИТИКА] плеера.
      near: view?.near ?? 0.025, far: view?.far ?? 100,
    },
    // ЗО[ПОЛИТИКА]: размер контактной тени = maxDim*1.5 — эвристика плеера, не данные объекта.
    shadowScale: maxDim * 1.5, skin, skinKey: useSkin, shadow, note,
  }
}

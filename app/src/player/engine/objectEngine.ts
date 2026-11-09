import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { LoadedObject } from './objectLoader'
import { partUrl } from './objectLoader'
import { loadSkin, bindSkin, type SkinBinding, type SkinBundle } from '../materials/skinLoader'
import { parseSkinKey, skinFile, skinSurface } from '../materials/skinContract'
import { loadShadow, shadowDeclaration, shadowLightFromScene, type PreparedShadow, type SceneShadowLight } from '../sockets/shadowSocket'
import { objectToMetres, sceneDeclaration, type SceneDeclaration, type SceneProfile } from '../scenes/sceneContract'
import { compositionFrame } from '../../compositionCamera'
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

/** Объект, собранный НЕЗАВИСИМО от сцены: геометрия, скин, тень, ракурс, единицы.
 *  В сцену его ставит placeInScene() — при загрузке и при каждой смене сцены. */
export interface BuiltObject {
  root: Group
  /** сцены, в которых объект хочет рендериться (render.scenes), по приоритету */
  scenes: SceneDeclaration
  /** во сколько раз умножить геометрию, чтобы получить метры (render.units × render.scale) */
  toMetres: number
  /** границы кадра в единицах объекта (render.frame.boundsByState[state]); null — считать по геометрии */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null
  /** пол объявлен объектом (frame.floor === 'Y0') — не приземляем */
  floorDeclared: boolean
  /** ракурс по умолчанию из каталога камер объекта; null — дефолты плеера */
  view: any | null
  /** живая привязка скина — через неё меняем скин без перезагрузки геометрии */
  skin: SkinBinding | null
  skinKey: string | null
  /** тень, которую выбрал объект (пакет из shadows/); null — объект явно без тени */
  shadow: PreparedShadow | null
  note: string
}

export interface PlayerCamera { position: [number, number, number]; target: [number, number, number]; fov: number; roll: number; near: number; far: number }

/** Объект, поставленный в конкретную сцену. */
export interface Placement {
  sceneKey: string
  scene: SceneProfile
  /** итоговый масштаб объекта в сцене: toMetres × scene.coordinates.worldScale */
  worldScale: number
  camera: PlayerCamera
  /** свет сцены для тени объекта (направление и чёткость); null — объект без тени */
  shadowLight: SceneShadowLight | null
}

/** Скин "<id>@<rev>" из пакета объекта. Строго: у объекта нет render.skin или скина нет в пакете — ошибка.
 *  ЗО[ОБЪЕКТ]: что объект принимает (совместимость, слоты, папка) — render.skin. ЗО[ПОЛИТИКА]: качество 'final', приоритет 'high'. */
export async function loadSkinBundle(o: LoadedObject, skinKey: string, signal: AbortSignal): Promise<SkinBundle> {
  const surface = skinSurface((o.manifest.render ?? {}) as Record<string, unknown>)
  if (!surface) throw new Error(`Object ${o.manifest.id}@${o.manifest.revision} does not accept skins (no render.skin)`)
  const ref = parseSkinKey(skinKey)
  const file = skinFile(surface, ref)
  const entry = (o.manifest.parts.skins ?? []).find((f: any) => f.file === file)
  if (!entry) throw new Error(`Skin ${skinKey} is not in object ${o.manifest.id}@${o.manifest.revision}`)
  return loadSkin(ref, 'final', signal, 'high', { basePath: o.base, surface, descriptor: { file: entry.file, sha256: entry.sha256, bytes: entry.bytes } })
}

async function fetchJson(base: string, ref: string, signal?: AbortSignal) {
  const r = await fetch(partUrl(base, ref), { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ref)
  return r.json()
}

/** ЕДИНЫЙ generic-движок. Читает только manifest.render.*, применяет общие правила.
 *  Кода «про конкретный объект» здесь нет — но решений о границах пока много (см. ЗО[...]).
 *  Сцену НЕ грузит: сцена — отдельная сущность (scenes/), её ставит плеер; объект в неё — placeInScene(). */
export async function buildFromManifest(o: LoadedObject, signal: AbortSignal, skinKey?: string): Promise<BuiltObject> {
  const r: any = o.manifest.render ?? {}

  // ЗО[ОБЪЕКТ]: в какой сцене рендериться, выбирает объект (render.scenes, порядок = приоритет).
  // ЗО[ОБЪЕКТ]: в каких единицах сделан объект и поправка к масштабу (render.units, render.scale).
  // Строго и заранее: без сцен или с непонятными единицами объект не показываем.
  const scenes = sceneDeclaration(r)
  const toMetres = objectToMetres(r)

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
  // ЗО[ОБЪЕКТ]: совместимость скина объявляет объект (render.skin). GLB может объявить свою (extras сцены) —
  // тогда она обязана совпасть с объектом (проверяет bindSkin). Движок её не подменяет.

  // ЗО[ОБЪЕКТ]: скин задаёт вызывающий (SKU); если не задан — дефолт объекта (render.defaultSkin).
  // Строго: скин не загрузился/не подошёл — ошибка всей сборки, без «геометрии без скина».
  let note = 'геометрия'
  const useSkin: string | null = skinKey ?? r.skin?.default ?? null
  let skin: SkinBinding | null = null
  if (useSkin) {
    skin = bindSkin({ root }, await loadSkinBundle(o, useSkin, signal))
    note = 'скин ' + useSkin
  }

  // ЗО[ОБЪЕКТ]: тень выбирает объект (render.shadow → пакет из shadows/). Движок тень не содержит.
  // ЗО[ГРАНИЦА]: направление и чёткость тени — от света СЦЕНЫ (подставляется в placeInScene);
  //   вид тени — от пакета тени. Строго: объект обязан объявить тень (или null).
  const shadowDecl = shadowDeclaration(r)
  let shadow: PreparedShadow | null = null
  if (shadowDecl) {
    shadow = await loadShadow(shadowDecl, signal)
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
      const cat: any = validateCameraViews(await fetchJson(o.base, r.camera, signal))
      const s = cat.states?.[state]
      view = (s?.views?.find((v: any) => v.id === s.defaultView) ?? s?.views?.[0])?.camera ?? null
    } catch { /* камера некритична */ }
  }

  const declared = r.frame?.boundsByState?.[state]
  return {
    root, scenes, toMetres,
    bounds: declared?.min && declared?.max ? { min: [...declared.min] as [number, number, number], max: [...declared.max] as [number, number, number] } : null,
    floorDeclared: r.frame?.floor === 'Y0',
    view, skin, skinKey: useSkin, shadow, note,
  }
}

/** Поставить объект в сцену. Сцена НЕ перестраивается под объект: объект масштабируется
 *  на toMetres × worldScale сцены. Вызывается при загрузке и при каждой смене сцены
 *  (меняет root.scale/position). Строго: требования тени к сцене не сошлись — ошибка. */
export function placeInScene(built: BuiltObject, sceneKey: string, scene: SceneProfile, viewport?: { width: number; height: number }): Placement {
  const { root } = built
  // ЗО[ГРАНИЦА]: тень требует от сцены свет (needsFromScene) — проверяем при каждой смене сцены.
  const shadowLight = built.shadow ? shadowLightFromScene(built.shadow, scene.settings) : null

  // ЗО[ОБЩЕЕ]: масштаб в мир = единицы объекта → метры (объект) × единиц сцены на метр (сцена).
  //   Равномерный setScalar. Ось не вращаем: движок ПРЕДПОЛАГАЕТ, что геометрия уже в системе
  //   движка (Y вверх, +Z вперёд) — это объект декларирует в render.frame.up/front, но движок это
  //   НЕ проверяет и НЕ доворачивает. ЗО[ВОПРОС]: кто приводит объект с другой осью к системе движка?
  const worldScale = built.toMetres * scene.coordinates.worldScale
  root.position.set(0, 0, 0)
  root.scale.setScalar(worldScale)
  root.updateMatrixWorld(true)

  // ЗО[ОБЪЕКТ]: границы кадра объект привозит сам (frame.boundsByState, в единицах объекта).
  // ЗО[ОБЪЕКТ]: пол объявлен объектом (frame.floor==='Y0') → не приземляем. Иначе — приземляем (общий фолбэк).
  // ЗО[ОБЩЕЕ]: приземление/фолбэк по bbox — общее правило.
  let box: Box3
  if (built.bounds) {
    box = new Box3(new Vector3(...built.bounds.min).multiplyScalar(worldScale), new Vector3(...built.bounds.max).multiplyScalar(worldScale))
    if (!built.floorDeclared) { const g = new Box3().setFromObject(root); root.position.y += box.min.y - g.min.y; root.updateMatrixWorld(true) }
  } else {
    const g = new Box3().setFromObject(root); root.position.y -= g.min.y; root.updateMatrixWorld(true)
    box = new Box3().setFromObject(root)
  }

  // ЗО[ОБЩЕЕ]: compositionFrame — общая математика кадра (одинаковая для всех объектов).
  // ЗО[ПОЛИТИКА]: дефолты, когда у объекта НЕТ камеры (az 24, el 0.3, fov 28, margin 1.12) — выбор плеера.
  // ЗО[ВОПРОС]: near/far ракурса и лимиты орбиты — в единицах сцены; чья камера при смене сцены — I-03 (отложено).
  const view = built.view
  const vw = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1440)
  const vh = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 1000)
  const f = compositionFrame(box, view?.azimuth ?? 24, view?.elevation ?? 0.3, vw, vh, {
    fov: view?.fov ?? 28, roll: view?.roll ?? 0, margin: view?.margin ?? 1.12, subject: view?.subject ?? [0, 0], zoom: view?.zoom ?? 1,
  })
  return {
    sceneKey, scene, worldScale, shadowLight,
    camera: {
      position: f.position.toArray() as [number, number, number],
      target: f.target.toArray() as [number, number, number],
      fov: f.fov, roll: f.roll ?? 0,
      // ЗО[ОБЪЕКТ]: near/far объект объявляет в ракурсе; дефолт (0.025/100) — ЗО[ПОЛИТИКА] плеера.
      near: view?.near ?? 0.025, far: view?.far ?? 100,
    },
  }
}

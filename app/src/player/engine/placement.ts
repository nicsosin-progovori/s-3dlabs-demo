import { Box3, Vector3 } from 'three'
import { compositionFrame } from '../../compositionCamera.ts'
import { shadowLightFromScene, type SceneShadowLight } from '../sockets/shadowSocket.ts'
import type { LoadedScene } from '../scenes/sceneLoader.ts'
import type { BuiltObject } from './objectEngine.ts'

/* РАССТАНОВКА: объект (собран без сцены, engine/objectEngine.ts) + сцена (scenes/) → кадр.
 * Чистая функция над three-объектами, без React и сети — поэтому проверяется node-тестами
 * (scripts/scene-switch.test.mjs). Зоны ответственности "ЗО[...]" — легенда в objectEngine.ts. */

export interface PlayerCamera { position: [number, number, number]; target: [number, number, number]; fov: number; roll: number; near: number; far: number }

/** Объект, поставленный в конкретную сцену. */
export interface Placement {
  scene: LoadedScene
  /** итоговый масштаб объекта в сцене: toMetres × scene.coordinates.worldScale */
  worldScale: number
  camera: PlayerCamera
  /** свет сцены для тени объекта (направление и чёткость); null — объект без тени */
  shadowLight: SceneShadowLight | null
}

/** Поставить объект в сцену. Сцена НЕ перестраивается под объект: объект масштабируется
 *  на toMetres × worldScale сцены. Вызывается при загрузке и при каждой смене сцены
 *  (меняет root.scale/position). Строго: требования тени к сцене не сошлись — ошибка. */
export function placeInScene(built: BuiltObject, scene: LoadedScene, viewport?: { width: number; height: number }): Placement {
  const { root } = built
  // ЗО[ГРАНИЦА]: тень требует от сцены свет (needsFromScene) — проверяем при каждой смене сцены.
  const shadowLight = built.shadow ? shadowLightFromScene(built.shadow, scene.profile.settings) : null

  // ЗО[ОБЩЕЕ]: масштаб в мир = единицы объекта → метры (объект) × единиц сцены на метр (сцена).
  //   Равномерный setScalar. Ось не вращаем: движок ПРЕДПОЛАГАЕТ, что геометрия уже в системе
  //   движка (Y вверх, +Z вперёд) — это объект декларирует в render.frame.up/front, но движок это
  //   НЕ проверяет и НЕ доворачивает. ЗО[ВОПРОС]: кто приводит объект с другой осью к системе движка?
  const worldScale = built.toMetres * scene.profile.coordinates.worldScale
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
    scene, worldScale, shadowLight,
    camera: {
      position: f.position.toArray() as [number, number, number],
      target: f.target.toArray() as [number, number, number],
      fov: f.fov, roll: f.roll ?? 0,
      // ЗО[ОБЪЕКТ]: near/far объект объявляет в ракурсе; дефолт (0.025/100) — ЗО[ПОЛИТИКА] плеера.
      near: view?.near ?? 0.025, far: view?.far ?? 100,
    },
  }
}

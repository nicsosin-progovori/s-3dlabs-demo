/* Типы данных сцены. Источник правды по форме JSON — схемы рядом:
 *   scene.schema.json             → SceneProfile     (scenes/<id>/<rev>/scene.json)
 *   scene-declaration.schema.json → SceneDeclaration (manifest.render.scenes)
 * Цепочка подключения и правила — docs/architecture/contracts.md, 04-scene.md. */

/** manifest.render.scenes: сцены, в которых объект хочет рендериться, "<id>@<rev>".
 *  Порядок — приоритет (первая — лучшая). Пока плеер берёт первую. */
export type SceneDeclaration = string[]

export type Vec3 = [number, number, number]

export interface SceneLight { position: Vec3; target: Vec3; color: string; intensity: number }

export interface SceneSoftbox { position: Vec3; scale: [number, number]; intensity: number; color: string }

/** Координатный договор сцены. Сцена не перестраивается под объект —
 *  движок переводит объект в метры (render.units × render.scale) и умножает на worldScale. */
export interface SceneCoordinates {
  modelUnits: 'metres'
  /** единиц сцены на метр */
  worldScale: number
  up: 'Y'
  groundY: 0
  front: '+Z'
}

export interface SceneSettings {
  exposure: number
  toneMapping: 'aces-filmic'
  /** наследие студии; плеер не читает */
  shadowType: 'basic'
  background: { top: string; bottom: string }
  ambient: number
  hemisphere: { intensity: number; sky: string; ground: string }
  /** ключевой свет; position — направление тени */
  key: SceneLight
  fill: SceneLight
  environment: { resolution: number; intensity: number; surround: string; boxes: SceneSoftbox[] }
  /** плеер читает radius и lightMapSize (свет для тени); остальное — наследие студии (ISSUES.md I-10) */
  shadow: {
    radius: number; contact: number; opacity: number; density: number; frames: number; resolution: number
    position: Vec3; color: string; scale: number; compositionScale: number
    areaSamples: number; contactSamples: number; lightMapSize: number
  }
  /** наследие студии; плеер не читает */
  shadowMap: { productResolution: number; groundResolution: number; bias: number; normalBias: number }
  /** наследие студии; плеер не читает */
  ao: { resolutionScale: number; intensity: number; radius: number; thickness: number; samples: number }
  revealMs: number
}

/** scenes/<id>/<rev>/scene.json */
export interface SceneProfile {
  $schema?: string
  schemaVersion: 1
  id: string
  revision: string
  label?: Record<string, string>
  engine: 'source-studio-v01'
  coordinates: SceneCoordinates
  settings: SceneSettings
}

/** Единицы, в которых сделан объект (manifest.render.units). */
export type ObjectUnits = 'metres' | 'centimetres' | 'millimetres'

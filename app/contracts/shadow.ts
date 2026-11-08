/* Типы данных тени. Источник правды по форме JSON — схемы рядом:
 *   shadow.schema.json             → ShadowDescriptor   (shadows/<id>/<rev>/shadow.json)
 *   shadow-declaration.schema.json → ShadowDeclaration  (manifest.render.shadow)
 * Цепочка подключения и правила — docs/architecture/contracts.md. */

/** manifest.render.shadow: какую тень выбрал объект. null — явно без тени. */
export interface ShadowDeclaration {
  /** "<id>@<rev>" пакета тени */
  use: string
  /** только параметры из ShadowDescriptor.params; не указанные — по умолчанию */
  params?: Record<string, unknown>
}

/** Описание одного параметра тени: что можно подстроить и в каких границах. */
export type ShadowParamSpec =
  | { type: 'number' | 'integer'; min: number; max: number; default: number; note?: string }
  | { type: 'color'; default: string; note?: string }
  | { type: 'vector3'; min: number; max: number; default: [number, number, number]; note?: string }

/** shadows/<id>/<rev>/shadow.json */
export interface ShadowDescriptor {
  schemaVersion: 1
  id: string
  revision: string
  label?: Record<string, string>
  /** версия API гнезда тени */
  apiVersion: number
  /** код тени, путь от папки пакета; проверяется по размеру и sha256 до исполнения */
  entry: { file: string; sha256: string; bytes: number }
  /** справочно: какие значения света сцены использует тень */
  needsFromScene?: string[]
  params: Record<string, ShadowParamSpec>
}

/** Что тень получает от СЦЕНЫ: направление и чёткость (граница — docs/architecture/shadow.md). */
export interface SceneShadowLight {
  /** позиция ключевого света — направление тени (scene.settings.key.position) */
  position: [number, number, number]
  /** размер источника — мягкость края (scene.settings.shadow.radius) */
  radius: number
  /** размер карты теней — чёткость (scene.settings.shadow.lightMapSize) */
  mapSize: number
}

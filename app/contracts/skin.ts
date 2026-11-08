/* Типы данных скина. Форма JSON — схемы рядом:
 *   skin-surface.schema.json → ObjectSkinSurface (manifest.render.skin: что объект принимает)
 *   skin.schema.json         → SkinManifest      (objects/<id>/<rev>/skins/<skin>/<rev>/skin.json)
 * Цепочка подключения — docs/architecture/contracts.md, правила — 02-skin.md. */
import type { SkinEnhancementRef } from './skinEnhancement.ts'

/** Ключ скина: id + revision ("<id>@<rev>" в SKU и манифесте). */
export interface SkinRef { id: string; revision: string }

/** Совместимость: набор строк, который ОБЪЯВЛЯЕТ ОБЪЕКТ. Скин подходит, если его набор совпадает целиком.
 *  Для бутылки: { modelId, uvLayout, materialBindings }; у другого объекта ключи могут быть другими. */
export type SkinCompatibility = Record<string, string>

/** manifest.render.skin — поверхность скина объекта: что объект принимает. */
export interface ObjectSkinSurface {
  compatibility: SkinCompatibility
  /** слоты материалов (extras.materialSlotId в GLB); базовый скин закрывает их ВСЕ */
  slots: string[]
  /** скин по умолчанию, "<id>@<rev>" — должен быть в manifest.parts.skins */
  default: string
  /** папка скинов в пакете объекта; путь скина — <dir>/<id>/<rev>/skin.json */
  dir: string
}

export type SkinQuality = 'low' | 'final'
export interface SkinImageAsset { name: string; file: string; sha256: string; bytes: number; width: number; height: number; mimeType: string }
export interface SkinTextureTransform { offset?: [number, number]; scale?: [number, number]; rotation?: number; texCoord?: number }
export interface SkinTextureInfo { index: number; texCoord?: number; scale?: number; strength?: number; extensions?: { KHR_texture_transform?: SkinTextureTransform } }
/** Материал слота — подмножество glTF-материала + extras.materialSlotId. */
export interface SkinMaterialDef {
  name: string
  extras: { materialSlotId: string }
  doubleSided?: boolean; alphaMode?: string; alphaCutoff?: number
  pbrMetallicRoughness?: { baseColorFactor?: [number, number, number, number]; metallicFactor?: number; roughnessFactor?: number; baseColorTexture?: SkinTextureInfo; metallicRoughnessTexture?: SkinTextureInfo }
  normalTexture?: SkinTextureInfo; occlusionTexture?: SkinTextureInfo; emissiveTexture?: SkinTextureInfo; emissiveFactor?: [number, number, number]
  extensions?: {
    KHR_materials_clearcoat?: { clearcoatFactor?: number; clearcoatRoughnessFactor?: number; clearcoatTexture?: SkinTextureInfo; clearcoatRoughnessTexture?: SkinTextureInfo; clearcoatNormalTexture?: SkinTextureInfo }
    KHR_materials_anisotropy?: { anisotropyStrength?: number; anisotropyRotation?: number; anisotropyTexture?: SkinTextureInfo }
  }
}
/** Набор текстур одного качества (low/final). */
export interface SkinProfile { images: SkinImageAsset[]; textures: Array<{ source: number; sampler?: number }>; samplers: Array<{ wrapS?: number; wrapT?: number; magFilter?: number; minFilter?: number }> }
/** skin.json */
export interface SkinManifest extends SkinRef {
  $schema?: string
  schemaVersion: 1
  compatibility: SkinCompatibility
  materials: SkinMaterialDef[]
  profiles: Record<SkinQuality, SkinProfile>
  enhancement?: SkinEnhancementRef
}

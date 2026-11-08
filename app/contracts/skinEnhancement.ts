/* Типы данных улучшения скина. Форма JSON — skin-enhancement.schema.json.
 * Цепочка подключения — docs/architecture/contracts.md, правила — docs/architecture/02-skin.md §7. */

/** skin.json → поле "enhancement". Путь — от корня пакета объекта. */
export interface SkinEnhancementRef {
  file: string
  sha256: string
  bytes: number
  /** параметры для модуля; движок их не читает */
  params?: unknown
}

/** Загрузчик SKU-записей (skus/<SKU>/sku.json). Общий для хоста и плеера.
 *  Строгий: любая несостыковка — ошибка, без фолбэков. */

export interface SimpleSku {
  schemaVersion: 1
  sku: string
  type: 'simple'
  object: string   // "<id>@<rev>"
  skin: string     // "<skinId>@<rev>"
}
export interface ConfigurableSku {
  schemaVersion: 1
  sku: string
  type: 'configurable'
  variants: string[]
  defaultVariant: string
}
export type SkuRecord = SimpleSku | ConfigurableSku

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/

export async function loadSku(sku: string, signal?: AbortSignal, baseUrl: string = location.href): Promise<SkuRecord> {
  if (!SKU_RE.test(sku)) throw new Error(`Invalid SKU "${sku}"`)
  const res = await fetch(new URL(`/skus/${sku}/sku.json`, baseUrl), { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`SKU ${sku}: HTTP ${res.status}`)
  const d: any = await res.json()
  if (d?.schemaVersion !== 1) throw new Error(`SKU ${sku}: unsupported schemaVersion`)
  if (d.sku !== sku) throw new Error(`SKU ${sku}: identity mismatch (${d.sku})`)
  if (d.type === 'simple') {
    if (!KEY_RE.test(d.object ?? '')) throw new Error(`SKU ${sku}: invalid object "${d.object}"`)
    if (!KEY_RE.test(d.skin ?? '')) throw new Error(`SKU ${sku}: invalid skin "${d.skin}"`)
    return d as SimpleSku
  }
  if (d.type === 'configurable') {
    if (!Array.isArray(d.variants) || !d.variants.length || !d.variants.every((v: unknown) => typeof v === 'string' && SKU_RE.test(v)))
      throw new Error(`SKU ${sku}: invalid variants`)
    if (!d.variants.includes(d.defaultVariant)) throw new Error(`SKU ${sku}: defaultVariant not in variants`)
    return d as ConfigurableSku
  }
  throw new Error(`SKU ${sku}: unknown type "${d.type}"`)
}

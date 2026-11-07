import type { BarControl } from '../controlBar'
import { setSku } from '../../playerContract'
import { loadSku, type ConfigurableSku } from '../../skuLoader'

/* Выбор продукта по SKU.
 *   1) Parent (configurable) — список захардкожен (позже — из базы).
 *   2) SKU — варианты выбранного parent, из его skus/<SKU>/sku.json.
 * В плеер уходит только simple SKU. Хост владеет URL: ?sku=<SKU>
 *   • ?sku=<parent> → parent + его defaultVariant;
 *   • ?sku=<simple> → ищем parent, у которого он в variants;
 *   • неизвестный   → чистим URL, ничего не показываем. */
const PARENTS: string[] = ['44-MO9431-C']

function writeUrl(sku: string) {
  const u = new URL(location.href)
  if (sku) u.searchParams.set('sku', sku)
  else u.searchParams.delete('sku')
  history.replaceState(null, '', u)
}

function labeled(text: string, el: HTMLElement) {
  const l = document.createElement('label')
  l.className = 'cb-field'
  const span = document.createElement('span')
  span.textContent = text
  l.append(span, el)
  return l
}

export const skuSelect: BarControl = {
  id: 'sku',
  title: 'Продукт',
  mount(el) {
    const parentSel = document.createElement('select')
    parentSel.add(new Option('— parent SKU —', ''))
    for (const p of PARENTS) parentSel.add(new Option(p, p))

    const skuSel = document.createElement('select')
    skuSel.disabled = true

    const status = document.createElement('div')
    status.className = 'cb-note'

    el.append(labeled('Parent', parentSel), labeled('SKU', skuSel), status)

    const parents = new Map<string, ConfigurableSku>()   // кэш прочитанных parent-записей
    async function getParent(sku: string): Promise<ConfigurableSku> {
      const hit = parents.get(sku)
      if (hit) return hit
      const rec = await loadSku(sku)
      if (rec.type !== 'configurable') throw new Error(`${sku} is not configurable`)
      parents.set(sku, rec)
      return rec
    }

    function show(sku: string) { writeUrl(sku); setSku(sku || null) }

    function fillVariants(p: ConfigurableSku | null, selected: string) {
      skuSel.replaceChildren()
      if (!p) { skuSel.disabled = true; return }
      for (const v of p.variants) skuSel.add(new Option(v + (v === p.defaultVariant ? '  (default)' : ''), v))
      skuSel.value = selected
      skuSel.disabled = false
    }

    async function selectParent(parent: string, variant?: string) {
      status.textContent = ''
      parentSel.value = parent
      if (!parent) { fillVariants(null, ''); show(''); return }
      try {
        const p = await getParent(parent)
        const v = variant ?? p.defaultVariant
        fillVariants(p, v)
        show(v)
      } catch (e) {
        fillVariants(null, '')
        status.textContent = (e as Error).message
        show('')
      }
    }

    parentSel.addEventListener('change', () => { void selectParent(parentSel.value) })
    skuSel.addEventListener('change', () => show(skuSel.value))

    // начальное состояние из ?sku=
    const fromUrl = new URLSearchParams(location.search).get('sku') ?? ''
    void (async () => {
      if (!fromUrl) return
      if (PARENTS.includes(fromUrl)) return selectParent(fromUrl)
      for (const p of PARENTS) {
        const rec = await getParent(p).catch(() => null)
        if (rec?.variants.includes(fromUrl)) return selectParent(p, fromUrl)
      }
      writeUrl('')   // SKU не из известных parent — ничего не показываем
    })()
  },
}

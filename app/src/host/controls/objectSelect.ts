import type { BarControl } from '../controlBar'
import { sendLoad, setInitialObject } from '../../playerContract'

/* Выбор объекта. Список захардкожен — добавить объект = добавить строку.
 * Хост владеет URL (?object=); плеер про URL не знает (кроме фолбэка при старте). */
const OBJECTS: { key: string; label: string }[] = [
  { key: 'bottle@v01', label: 'Термобутылка (bottle@v01)' },
]

function writeUrl(key: string) {
  const u = new URL(location.href)
  if (key) u.searchParams.set('object', key)
  else u.searchParams.delete('object')
  history.replaceState(null, '', u)
}

export const objectSelect: BarControl = {
  id: 'object',
  title: 'Объект',
  mount(el) {
    const sel = document.createElement('select')
    sel.add(new Option('— выберите объект —', ''))
    for (const o of OBJECTS) sel.add(new Option(o.label, o.key))
    el.append(sel)

    // deep-link ?object= — только если такой объект есть в списке; «мусор» из URL чистим
    const fromUrl = new URLSearchParams(location.search).get('object')
    const known = !!fromUrl && OBJECTS.some(o => o.key === fromUrl)
    sel.value = known ? fromUrl! : ''
    setInitialObject(sel.value || null)       // начальное — до монтирования плеера, без события
    if (fromUrl && !known) writeUrl('')

    sel.addEventListener('change', () => {
      writeUrl(sel.value)
      sendLoad(sel.value || null)
    })
  },
}

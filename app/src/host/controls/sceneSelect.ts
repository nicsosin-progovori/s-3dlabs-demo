import type { BarControl } from '../controlBar'
import { onSceneChanged, readScene, setScene } from '../../player/engine/playerContract'

/* Выбор сцены (#4).
 * Сцену выбирает ОБЪЕКТ (manifest.render.scenes): при загрузке объекта плеер ставит его сцену.
 * Здесь хост может сменить сцену у уже показанного объекта. Список сцен — пока хардкод
 * (позже — из индекса scenes/ или API). Значение селекта всегда = то, что сообщил плеер. */
const SCENES: string[] = ['source-studio@v01', 'source-studio@v02']

export const sceneSelect: BarControl = {
  id: 'scene',
  title: 'Сцена',
  mount(el) {
    const sel = document.createElement('select')
    const none = new Option('— объект не показан —', '')
    sel.add(none)
    for (const s of SCENES) sel.add(new Option(s, s))

    const label = document.createElement('label')
    label.className = 'cb-field'
    const span = document.createElement('span')
    span.textContent = 'Сцена'
    label.append(span, sel)

    const note = document.createElement('div')
    note.className = 'cb-note'
    el.append(label, note)

    function sync(scene: string | null) {
      const key = scene ?? ''
      if (key && ![...sel.options].some(o => o.value === key)) sel.add(new Option(key, key))   // сцена объекта вне списка — всё равно показываем
      sel.value = key
      sel.disabled = !key
      none.disabled = !!key
      note.textContent = key ? '' : 'Сцену выбирает объект при загрузке'
    }

    sel.addEventListener('change', () => { if (sel.value) setScene(sel.value) })
    onSceneChanged(sync)
    sync(readScene() || null)
  },
}

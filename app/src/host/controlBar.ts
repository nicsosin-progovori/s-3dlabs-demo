/* ═══════════════════════════════════════════════════════════════════════════
 * CONTROL BAR — панель хоста. Обычный DOM, НЕ часть React/плеера.
 * Плееру командует только через src/player/engine/playerContract.ts.
 *
 * Бар — это просто реестр контролов. Каждый контрол = секция бара:
 *   { id, title, mount(el) }  — mount рисует свой DOM внутри el.
 * Добавить действие = написать контрол в ./controls/ и вписать его в main.ts.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BarControl {
  id: string
  title: string
  mount(el: HTMLElement): void
}

export function mountControlBar(bar: HTMLElement, controls: BarControl[]): void {
  bar.replaceChildren()

  const head = document.createElement('header')
  head.className = 'cb-head'
  head.textContent = 'S. 3DLABS'
  bar.append(head)

  for (const c of controls) {
    const section = document.createElement('section')
    section.className = 'cb-section'
    section.dataset.control = c.id
    const h = document.createElement('h2')
    h.textContent = c.title
    const body = document.createElement('div')
    body.className = 'cb-body'
    section.append(h, body)
    bar.append(section)
    c.mount(body)
  }
}

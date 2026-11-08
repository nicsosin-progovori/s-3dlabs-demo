/* ═══════════════════════════════════════════════════════════════════════════
 * ПУБЛИЧНЫЙ КОНТРАКТ host ↔ player — ЕДИНСТВЕННОЕ место, где он описан.
 * Единица общения — SKU (стабильный, без версии). Плеер принимает только
 * simple SKU; что за ним стоит (объект, скин), плеер читает сам из skus/<SKU>/.
 *
 *   • текущий SKU — атрибут #root[data-sku]   (нет атрибута = ничего не показывать)
 *   • команда     — window CustomEvent 's3d:load', detail { sku: "<SKU>" | null }
 * Хост всегда делает и то, и другое (setSku): атрибут — истина для плеера,
 * который смонтируется позже; событие — для уже работающего.
 * Новое публичное действие = запись в PLAYER_COMMANDS + пара функций ниже.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PLAYER_ROOT_ID = 'root'

export const PLAYER_COMMANDS = {
  load: 's3d:load',
} as const

export interface LoadCommand { sku: string | null }

/* ── host-сторона ─────────────────────────────────────────────────────────── */

export function setSku(sku: string | null): void {
  const root = document.getElementById(PLAYER_ROOT_ID)
  if (root) { if (sku) root.dataset.sku = sku; else delete root.dataset.sku }
  window.dispatchEvent(new CustomEvent<LoadCommand>(PLAYER_COMMANDS.load, { detail: { sku } }))
}

/* ── player-сторона ───────────────────────────────────────────────────────── */

export function readSku(): string {
  return document.getElementById(PLAYER_ROOT_ID)?.dataset.sku ?? ''
}

/** Подписка на load. Возвращает отписку (удобно для useEffect). */
export function onLoad(handler: (sku: string | null) => void): () => void {
  const listener = (e: Event) => {
    const sku = (e as CustomEvent<LoadCommand>).detail?.sku
    handler(typeof sku === 'string' && sku ? sku : null)
  }
  window.addEventListener(PLAYER_COMMANDS.load, listener)
  return () => window.removeEventListener(PLAYER_COMMANDS.load, listener)
}

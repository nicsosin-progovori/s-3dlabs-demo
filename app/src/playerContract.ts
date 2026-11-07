/* ═══════════════════════════════════════════════════════════════════════════
 * ПУБЛИЧНЫЙ КОНТРАКТ host ↔ player — ЕДИНСТВЕННОЕ место, где он описан.
 * Плеер (ObjectViewer) — чистый потребитель: слушает команды и рендерит.
 * Хост (control bar, чужая страница, тест) — командует, импортируя этот модуль
 * или повторяя то же самое на чистом DOM (событие + атрибут — без зависимостей).
 *
 * Сейчас в контракте:
 *   • начальный объект — #root[data-object] = "<id>@<rev>" (нет → ?object= → пусто);
 *   • команда load     — window CustomEvent 's3d:load', detail { object: "<id>@<rev>" | null }.
 * Новое публичное действие = новая запись в PLAYER_COMMANDS + send/on-пара ниже.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PLAYER_ROOT_ID = 'root'

export const PLAYER_COMMANDS = {
  load: 's3d:load',
} as const

/** Ключ объекта "<id>@<rev>". null — очистить плеер. */
export type ObjectKey = string
export interface LoadCommand { object: ObjectKey | null }

/* ── host-сторона ─────────────────────────────────────────────────────────── */

/** Начальный объект — ДО монтирования плеера (без события). */
export function setInitialObject(key: ObjectKey | null): void {
  const root = document.getElementById(PLAYER_ROOT_ID)
  if (!root) return
  if (key) root.dataset.object = key
  else delete root.dataset.object
}

export function sendLoad(object: ObjectKey | null): void {
  window.dispatchEvent(new CustomEvent<LoadCommand>(PLAYER_COMMANDS.load, { detail: { object } }))
}

/* ── player-сторона ───────────────────────────────────────────────────────── */

export function readInitialObject(): ObjectKey {
  const fromAttr = document.getElementById(PLAYER_ROOT_ID)?.dataset.object
  const fromUrl = new URLSearchParams(location.search).get('object')
  return fromAttr || fromUrl || ''
}

/** Подписка на load. Возвращает отписку (удобно для useEffect). */
export function onLoad(handler: (object: ObjectKey | null) => void): () => void {
  const listener = (e: Event) => {
    const key = (e as CustomEvent<LoadCommand>).detail?.object
    handler(typeof key === 'string' && key ? key : null)
  }
  window.addEventListener(PLAYER_COMMANDS.load, listener)
  return () => window.removeEventListener(PLAYER_COMMANDS.load, listener)
}

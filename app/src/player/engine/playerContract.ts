/* ═══════════════════════════════════════════════════════════════════════════
 * ПУБЛИЧНЫЙ КОНТРАКТ host ↔ player — ЕДИНСТВЕННОЕ место, где он описан.
 * Единица общения — SKU (стабильный, без версии). Плеер принимает только
 * simple SKU; что за ним стоит (объект, скин), плеер читает сам из skus/<SKU>/.
 *
 *   • текущий SKU — атрибут #root[data-sku]   (нет атрибута = ничего не показывать)
 *   • команда     — window CustomEvent 's3d:load', detail { sku: "<SKU>" | null }
 * Хост всегда делает и то, и другое (setSku): атрибут — истина для плеера,
 * который смонтируется позже; событие — для уже работающего.
 *
 * СЦЕНА (#4). Сцену выбирает ОБЪЕКТ (manifest.render.scenes): при загрузке объекта
 * плеер ставит его сцену, что бы ни просил хост раньше. Хост может сменить сцену
 * у уже показанного объекта:
 *   • команда   — window CustomEvent 's3d:scene', detail { scene: "<id>@<rev>" }
 *                 (объекта нет — команда игнорируется: объект ведёт при загрузке)
 *   • отчёт     — атрибут #root[data-scene] = текущая сцена ("<id>@<rev>", нет — пусто)
 *                 + window CustomEvent 's3d:scene-changed', detail { scene }
 * Ошибка сцены — состояние плеера error (строго).
 * Новое публичное действие = запись в PLAYER_COMMANDS + пара функций ниже.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PLAYER_ROOT_ID = 'root'

export const PLAYER_COMMANDS = {
  load: 's3d:load',
  scene: 's3d:scene',
} as const

export const PLAYER_EVENTS = {
  sceneChanged: 's3d:scene-changed',
} as const

export interface LoadCommand { sku: string | null }
export interface SceneCommand { scene: string }
export interface SceneChanged { scene: string | null }

/* ── host-сторона ─────────────────────────────────────────────────────────── */

export function setSku(sku: string | null): void {
  const root = document.getElementById(PLAYER_ROOT_ID)
  if (root) { if (sku) root.dataset.sku = sku; else delete root.dataset.sku }
  window.dispatchEvent(new CustomEvent<LoadCommand>(PLAYER_COMMANDS.load, { detail: { sku } }))
}

/** Попросить плеер сменить сцену у показанного объекта. */
export function setScene(scene: string): void {
  window.dispatchEvent(new CustomEvent<SceneCommand>(PLAYER_COMMANDS.scene, { detail: { scene } }))
}

/** Текущая сцена плеера ("<id>@<rev>") или '' — ничего не показано. */
export function readScene(): string {
  return document.getElementById(PLAYER_ROOT_ID)?.dataset.scene ?? ''
}

/** Подписка на отчёт плеера о смене сцены. Возвращает отписку. */
export function onSceneChanged(handler: (scene: string | null) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<SceneChanged>).detail?.scene ?? null)
  window.addEventListener(PLAYER_EVENTS.sceneChanged, listener)
  return () => window.removeEventListener(PLAYER_EVENTS.sceneChanged, listener)
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

/** Подписка на команду смены сцены. Возвращает отписку. */
export function onScene(handler: (scene: string) => void): () => void {
  const listener = (e: Event) => {
    const scene = (e as CustomEvent<SceneCommand>).detail?.scene
    if (typeof scene === 'string' && scene) handler(scene)
  }
  window.addEventListener(PLAYER_COMMANDS.scene, listener)
  return () => window.removeEventListener(PLAYER_COMMANDS.scene, listener)
}

/** Плеер сообщает текущую сцену: атрибут на корне + событие. */
export function reportScene(scene: string | null): void {
  const root = document.getElementById(PLAYER_ROOT_ID)
  if (root) { if (scene) root.dataset.scene = scene; else delete root.dataset.scene }
  window.dispatchEvent(new CustomEvent<SceneChanged>(PLAYER_EVENTS.sceneChanged, { detail: { scene } }))
}

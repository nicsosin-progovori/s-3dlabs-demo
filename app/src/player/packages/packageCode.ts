/** Общие правила для КОДА, приезжающего пакетом (улучшения скинов, тени, …):
 *  байты проверяются по размеру и sha256 ДО исполнения; модуль грузится из этих байтов. */

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), v => v.toString(16).padStart(2, '0')).join('')
}

/** Скачать файл и проверить размер + sha256. Строго: несовпадение — ошибка. */
export async function fetchVerified(url: string, sha256: string, bytes: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`Package code HTTP ${response.status}: ${url}`)
  const data = await response.arrayBuffer()
  if (data.byteLength !== bytes || await sha256Hex(data) !== sha256) throw new Error(`Package code integrity mismatch: ${url}`)
  return data
}

/** Загрузить ES-модуль из уже проверенных байтов; вернуть его export default. */
export async function importCode<T = unknown>(code: ArrayBuffer): Promise<T | undefined> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const loaded = await import(/* @vite-ignore */ url) as { default?: T }
    return loaded.default
  } finally {
    URL.revokeObjectURL(url)
  }
}

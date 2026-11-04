export async function probePreview(url, timeoutMs = 8000) {
  const checkedAt = new Date().toISOString()
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: {
      'ngrok-skip-browser-warning': '1', 'serveo-skip-browser-warning': 'true',
    } })
    if (!response.ok) return { available: false, httpStatus: response.status, checkedAt, reason: `HTTP ${response.status}` }
    const html = await response.text()
    const available = html.includes('<title>S. 3DLABS</title>') && html.includes('id="root"') && html.includes('<script type="module"')
    return { available, httpStatus: response.status, checkedAt,
      reason: available ? null : 'Вместо приложения вернулась другая или пустая страница' }
  } catch (error) {
    return { available: false, httpStatus: null, checkedAt, reason: error.message }
  }
}

export function publicStatus(session, processAlive, health) {
  if (!session) return { status: 'not_configured', processAlive: false, available: false }
  if (!processAlive) return { ...session, status: ['failed', 'stopped'].includes(session.status) ? session.status : 'offline',
    processAlive: false, available: false }
  return { ...session, status: health ? (health.available ? 'running' : 'unavailable') : 'starting',
    processAlive: true, ...(health ?? { available: false }) }
}

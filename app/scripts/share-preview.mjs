import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probePreview, publicStatus } from './share-health.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(import.meta.url)
const directory = join(root, '.cache/share')
const sessionFile = join(directory, 'session-current.json')
const logFile = join(directory, 'share-preview.log')
const binary = join(root, '.cache/tools/ngrok/ngrok')
const configFile = join(directory, 'ngrok.yml')
const args = process.argv.slice(2)
const mode = args[0] ?? 'start'

async function readSession() {
  try { return JSON.parse(await readFile(sessionFile, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function isRunning(session) {
  if (!session?.pid || !session?.id) return false
  try {
    const command = execFileSync('/bin/ps', ['-p', String(session.pid), '-o', 'args='], { encoding: 'utf8' })
    return command.includes(script) && command.includes(`run ${session.id}`)
  } catch { return false }
}

async function main() {
  const existing = await readSession()
  if (mode === 'status') {
    const alive = isRunning(existing)
    const health = alive && existing.url ? await probePreview(existing.url) : null
    console.log(JSON.stringify(publicStatus(existing, alive, health), null, 2))
    return
  }
  if (mode === 'stop') {
    if (!isRunning(existing)) { console.log('Активного туннеля нет.'); return }
    process.kill(existing.pid, 'SIGTERM')
    console.log('Остановка туннеля, предпросмотра и предотвращения автосна запрошена.')
    return
  }
  if (mode !== 'start' && mode !== 'run') throw new Error('Используйте start, status или stop.')
  if (args.includes('--hours')) throw new Error('Таймер отключения убран. Показ работает до команды share:stop.')
  await access(binary)
  let token
  try { token = JSON.parse(await readFile(configFile, 'utf8')).agent?.authtoken }
  catch { throw new Error('Сначала подключите аккаунт: npm run share:connect') }
  if (!token) throw new Error('Сначала подключите аккаунт: npm run share:connect')
  await access(join(root, 'dist/index.html'))
  await mkdir(directory, { recursive: true })
  if (mode === 'start') {
    if (isRunning(existing)) throw new Error(`Туннель уже запущен: ${existing.url ?? 'соединение устанавливается'}`)
    const log = openSync(logFile, 'a', 0o600)
    const child = spawn(process.execPath, [script, 'run', randomUUID()], {
      cwd: root, detached: true, stdio: ['ignore', log, log],
    })
    closeSync(log)
    child.on('error', error => { console.error(error.message); process.exitCode = 1 })
    child.unref()
    console.log(`Фоновый показ запущен, PID ${child.pid}. Адрес и состояние: npm run share:status`)
    console.log(`Журнал: ${logFile}`)
    return
  }

  const state = {
    id: args[1], provider: 'ngrok', status: 'starting', pid: process.pid,
    localOrigin: 'http://127.0.0.1:4174', directory: 'dist',
    startedAt: new Date().toISOString(), expiresAt: null,
    url: null, tunnelPid: null, caffeinatePid: null, available: false,
  }
  let pendingSave = Promise.resolve()
  function save() {
    const snapshot = JSON.stringify(state, null, 2) + '\n'
    pendingSave = pendingSave.then(async () => {
      await writeFile(sessionFile + '.tmp', snapshot, { mode: 0o600 })
      await rename(sessionFile + '.tmp', sessionFile)
    })
    return pendingSave
  }
  let preview, tunnel, awake, startupTimer, healthTimer
  let stopping = false
  let checking = false
  async function checkHealth() {
    if (stopping || checking || !state.url) return
    checking = true
    try {
      const health = await probePreview(state.url)
      if (stopping) return
      Object.assign(state, health, { status: health.available ? 'running' : 'unavailable' })
      if (health.available) {
        state.readyAt ??= new Date().toISOString()
        clearTimeout(startupTimer)
      }
      await save()
    } finally { checking = false }
  }
  async function finish(status, reason, code = 0) {
    if (stopping) return
    stopping = true
    clearInterval(healthTimer)
    clearTimeout(startupTimer)
    Object.assign(state, { status, available: false, reason, stoppedAt: new Date().toISOString() })
    await save()
    const forcedExit = setTimeout(() => {
      if (tunnel?.exitCode === null) tunnel.kill('SIGKILL')
      process.exit(code)
    }, 5000)
    forcedExit.unref()
    if (tunnel?.pid && tunnel.exitCode === null && tunnel.signalCode === null) {
      const closed = new Promise(resolve => tunnel.once('close', resolve))
      tunnel.kill('SIGTERM')
      const forceTunnel = setTimeout(() => tunnel.kill('SIGKILL'), 2000)
      await closed
      clearTimeout(forceTunnel)
    }
    awake?.kill('SIGTERM')
    if (preview) await new Promise(resolve => {
      preview.httpServer.close(resolve)
      preview.httpServer.closeAllConnections()
    })
    console.log(`${state.stoppedAt} ${status}: ${reason}`)
    process.exit(code)
  }
  process.on('SIGTERM', () => void finish('stopped', 'Остановлено владельцем'))
  process.on('SIGINT', () => void finish('stopped', 'Остановлено владельцем'))
  process.on('uncaughtException', error => void finish('failed', error.message, 1))
  process.on('unhandledRejection', error => void finish('failed', String(error), 1))
  await save()
  startupTimer = setTimeout(() => void finish('failed', 'Соединение не установлено за 90 секунд', 1), 90000)
  healthTimer = setInterval(() => void checkHealth(), 60000)
  try {
    const { preview: startPreview } = await import('vite')
    preview = await startPreview({ root, configFile: join(root, 'vite.config.ts'), preview: {
      host: '127.0.0.1', port: 4174, strictPort: true, allowedHosts: [],
    } })
    awake = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    state.caffeinatePid = awake.pid
    awake.on('error', error => void finish('failed', error.message, 1))
    awake.on('exit', () => { if (!stopping) void finish('failed', 'Предотвращение автосна остановилось', 1) })
    tunnel = spawn(binary, [
      'http', state.localOrigin, '--config', configFile, '--host-header=127.0.0.1:4174',
      '--inspect=false', '--log', 'stdout', '--log-format', 'json',
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    state.tunnelPid = tunnel.pid
    function receiver() {
      let pending = ''
      return chunk => {
        pending += chunk.toString()
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end).replaceAll(token, '[redacted]')
          pending = pending.slice(end + 1)
          process.stdout.write(line + '\n')
          const url = line.match(/https:\/\/[a-z0-9-]+\.(?:ngrok-free\.(?:app|dev)|ngrok\.(?:app|dev|io))/)?.[0]
          if (url && !state.url) { state.url = url; void save(); void checkHealth() }
        }
      }
    }
    tunnel.stdout.on('data', receiver())
    tunnel.stderr.on('data', receiver())
    tunnel.on('error', error => void finish('failed', error.message, 1))
    tunnel.on('close', (code, signal) => {
      if (!stopping) void finish('failed', `ngrok завершился: ${signal ?? code}`, 1)
    })
    await save()
  } catch (error) {
    await finish('failed', error.message, 1)
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

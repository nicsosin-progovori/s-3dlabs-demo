import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, '.cache/share')
const path = join(directory, 'ngrok.yml')

async function main() {
  if (!process.stdin.isTTY) throw new Error('Запустите эту команду в обычном терминале для скрытого ввода токена.')
  console.log('Откройте https://dashboard.ngrok.com/get-started/your-authtoken')
  console.log('Войдите в бесплатный аккаунт и скопируйте только Authtoken. Пароль сюда не вводите.')
  process.stdout.write('Вставьте Authtoken и нажмите Enter (ввод скрыт): ')
  const token = await new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    const done = error => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', receive)
      process.stdout.write('\n')
      if (error) reject(error); else resolve(input.trim())
    }
    const receive = chunk => {
      if (chunk.includes('\u0003')) { done(new Error('Отменено')); return }
      if (/[\r\n]/.test(chunk)) { input += chunk.split(/[\r\n]/)[0]; done(); return }
      for (const char of chunk) {
        if (char === '\u007f' || char === '\b') input = input.slice(0, -1)
        else input += char
      }
    }
    process.stdin.on('data', receive)
  })
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(token)) throw new Error('Нужен только Authtoken, без команды, кавычек и пробелов. Значение не сохранено.')
  const config = { version: '3', agent: { authtoken: token, console_ui: false, remote_management: false,
    update_check: false, web_addr: '127.0.0.1:4048', proxy_url: 'socks5://127.0.0.1:10808' } }
  await mkdir(directory, { recursive: true })
  await writeFile(path + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await chmod(path + '.tmp', 0o600)
  await rename(path + '.tmp', path)
  console.log('Настройки сохранены локально. Запускаю показ без таймера отключения.')
  const result = spawnSync(process.execPath, [join(root, 'scripts/share-preview.mjs'), 'start'], { cwd: root, stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

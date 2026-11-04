import { accessSync, constants, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function resolveBlender() {
  if (process.env.BLENDER_BIN) return realpathSync(process.env.BLENDER_BIN)
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const candidate = join(directory, 'blender')
    try {
      accessSync(candidate, constants.X_OK)
      // Blender locates its Python and data relative to argv[0]; invoking a PATH symlink breaks that.
      return realpathSync(candidate)
    } catch { /* Keep looking on PATH. */ }
  }
  throw new Error('Blender не найден. Укажите полный путь через BLENDER_BIN.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = spawnSync(resolveBlender(), process.argv.slice(2), { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

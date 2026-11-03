import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

/** Use an installed browser only; this module never downloads or installs. */
export function chromiumPath(root) {
  if (process.env.BOTTLE_CHROMIUM_PATH) {
    if (!existsSync(process.env.BOTTLE_CHROMIUM_PATH)) throw new Error('BOTTLE_CHROMIUM_PATH does not exist')
    return process.env.BOTTLE_CHROMIUM_PATH
  }
  if (existsSync(chromium.executablePath())) return chromium.executablePath()
  for (let folder = root; ; folder = path.dirname(folder)) {
    const cache = path.join(folder, '.cache/playwright')
    if (existsSync(cache)) {
      for (const entry of readdirSync(cache).filter(s => /^chromium-\d+$/.test(s)).sort().reverse()) {
        for (const binary of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux64/chrome']) {
          const executable = path.join(cache, entry, binary)
          if (existsSync(executable)) return executable
        }
      }
      for (const entry of readdirSync(cache).filter(s => /^chromium_headless_shell-\d+$/.test(s)).sort().reverse()) {
        for (const binary of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
          const executable = path.join(cache, entry, binary)
          if (existsSync(executable)) return executable
        }
      }
    }
    if (path.dirname(folder) === folder) break
  }
  throw new Error('Chromium is not installed. Configure BOTTLE_CHROMIUM_PATH; see docs/BOTTLE_API.md')
}
export async function launchRenderBrowser(root) {
  return chromium.launch({headless:true,executablePath:chromiumPath(root),args:renderBrowserArgs()})
}
export function renderBrowserArgs(){
  return ['--enable-gpu','--enable-webgl','--ignore-gpu-blocklist',...(process.platform==='darwin'?['--use-angle=metal']:['--enable-unsafe-swiftshader'])]
}

import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('model download survives an interrupted transfer and preserves every GLB byte', async ({ page }) => {
  const file = await readFile('public/models/notebook/notebook.glb')
  const expectedHash = createHash('sha256').update(file).digest('hex')
  let mode: 'ranges' | 'whole' | 'invalid' = 'ranges'
  let interrupted = false
  await page.route('**/transport-fixture.glb', async route => {
    if (mode === 'whole') { await route.fulfill({ body: file }); return }
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/)
    if (!range) { await route.abort(); return }
    const start = Number(range[1])
    const end = Math.min(Number(range[2]), file.length - 1)
    if (mode === 'ranges' && start > 0 && !interrupted) {
      interrupted = true
      await route.abort('connectionreset')
      return
    }
    await route.fulfill({ status: 206, body: file.subarray(start, end + 1), headers: {
      'content-type': 'model/gltf-binary',
      'content-range': `bytes ${mode === 'invalid' ? start + 1 : start}-${end}/${file.length}`,
    } })
  })
  await page.goto('/?model=mug')
  const download = () => page.evaluate(async () => {
    const moduleUrl = '/src/download.ts'
    const { downloadModel } = await import(moduleUrl)
    try {
      const buffer = await downloadModel('/transport-fixture.glb')
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('')
      return { bytes: buffer.byteLength, hash, error: null }
    } catch (error) {
      return { bytes: 0, hash: null, error: String(error) }
    }
  })
  expect(await download()).toEqual({ bytes: file.length, hash: expectedHash, error: null })
  expect(interrupted).toBe(true)
  mode = 'whole'
  expect(await download()).toEqual({ bytes: file.length, hash: expectedHash, error: null })
  mode = 'invalid'
  expect((await download()).error).toBeTruthy()
})

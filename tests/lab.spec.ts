import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240"><rect x="10" y="20" width="180" height="180" rx="30" fill="#2871de"/><path d="m55 110 30 30 65-70" fill="none" stroke="white" stroke-width="16"/><text x="220" y="155" font-family="sans-serif" font-weight="bold" font-size="100" fill="#2871de">TEST</text></svg>')

const choices = [
  { id: 'front', name: /^Vorderseite,/ },
  { id: 'back', name: /^Rückseite,/ },
  { id: 'opposite', name: /^Gegenüber dem Henkel,/ },
  { id: 'side-ts', name: /^Rundum · groß,/ },
  { id: 'roundscreen', name: /^Rundum,/ },
]

const bluePixelCount = (canvas: Locator) => canvas.evaluate((element: HTMLCanvasElement) => {
  const copy = document.createElement('canvas')
  copy.width = element.width
  copy.height = element.height
  const context = copy.getContext('2d')!
  context.drawImage(element, 0, 0)
  const data = context.getImageData(0, 0, copy.width, copy.height).data
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 2] > data[index] + 40 && data[index + 2] > data[index + 1] + 20 && data[index + 2] > 70) count++
  }
  return count
})

test('real mug, fixed print zones, transparent logo and PNG', async ({ page }) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url())
  })
  await page.goto('/?model=mug')
  const scene = page.getByTestId('scene')
  const canvas = scene.locator('canvas')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-model-meshes', '2')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  await expect.poll(async () => Math.abs(Number(await scene.getAttribute('data-ground-gap')))).toBeLessThan(0.00001)
  await expect(page.locator('input[type=file]')).toHaveCount(1)
  await expect(page.locator('input[type=range], input[type=color], select')).toHaveCount(0)
  await expect(page.getByRole('radio')).toHaveCount(6)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.locator('body')).not.toContainText(/[А-Яа-яЁё]/)
  await page.screenshot({ path: '.cache/qa/mug-minimal.png', fullPage: true })

  const bluePixels = () => bluePixelCount(canvas)

  await page.getByLabel('Logodatei', { exact: true }).setInputFiles({ name: 'test-logo.svg', mimeType: 'image/svg+xml', buffer: svg })
  await expect(page.getByText('test-logo.svg', { exact: true })).toBeVisible()
  for (const choice of choices) {
    await page.getByRole('radio', { name: choice.name }).check()
    await expect(scene).toHaveAttribute('data-zone', choice.id)
    await expect.poll(bluePixels).toBeGreaterThan(200)
    await scene.screenshot({ path: `.cache/qa/mug-${choice.id}.png` })
  }

  await page.getByRole('radio', { name: 'Ohne Druck', exact: true }).check()
  await expect.poll(bluePixels).toBeLessThan(5)
  await scene.screenshot({ path: '.cache/qa/mug-plain.png' })
  await page.getByRole('radio', { name: /^Vorderseite,/ }).check()
  await expect.poll(bluePixels).toBeGreaterThan(200)

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG herunterladen' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('mug-front.png')
  const png = await readFile((await download.path())!)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.length).toBeGreaterThan(20_000)

  await page.getByLabel('Logodatei', { exact: true }).setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await expect(page.getByRole('alert')).toContainText('Bitte wähle eine PNG-')
  await expect(page.getByText('test-logo.svg', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Logo entfernen', exact: true }).click()
  await expect.poll(bluePixels).toBeLessThan(5)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('mobile layout and orbiting the real mug', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?model=mug')
  const scene = page.getByTestId('scene')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  const canvas = scene.locator('canvas')
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL().length)).toBeGreaterThan(20_000)
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before)
  await page.getByRole('radio', { name: /^Rückseite,/ }).check()
  await expect(scene).toBeInViewport({ ratio: 0.99 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.cache/qa/mug-mobile.png', fullPage: true })
})

test('clean pen, fixed laser engraving, model switching and PNG', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?model=pen')
  const scene = page.getByTestId('scene')
  const canvas = scene.locator('canvas')
  await expect(scene).toHaveAttribute('data-product', 'pen')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  await expect.poll(async () => Math.abs(Number(await scene.getAttribute('data-ground-gap')))).toBeLessThan(0.00001)
  await expect(page.getByRole('radio')).toHaveCount(2)
  const engraving = page.getByRole('radio', { name: /^Neben dem Clip, 40 × 6 mm/ })
  await expect(engraving).toBeChecked()
  await expect(page.locator('input[type=file]')).toHaveCount(1)
  await expect(page.locator('input[type=range], input[type=color], select')).toHaveCount(0)

  await page.getByLabel('Logodatei', { exact: true }).setInputFiles({ name: 'test-logo.svg', mimeType: 'image/svg+xml', buffer: svg })
  await expect(page.getByText('test-logo.svg', { exact: true })).toBeVisible()
  const renderedImage = () => canvas.evaluate((element: HTMLCanvasElement) => new Promise<string>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.toDataURL())))))
  const withLogo = await renderedImage()
  await expect.poll(() => bluePixelCount(canvas)).toBeLessThan(5)
  await scene.screenshot({ path: '.cache/qa/pen-engraved.png' })
  await page.getByRole('radio', { name: 'Ohne Druck', exact: true }).check()
  await expect.poll(renderedImage).not.toBe(withLogo)
  await scene.screenshot({ path: '.cache/qa/pen-plain.png' })
  await engraving.check()

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG herunterladen' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('pen-beside-clip.png')
  const png = await readFile((await download.path())!)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.length).toBeGreaterThan(10_000)

  await page.getByRole('button', { name: 'Tasse', exact: true }).click()
  await expect(scene).toHaveAttribute('data-product', 'mug')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(page.getByRole('radio')).toHaveCount(6)
  await expect(page.getByText('test-logo.svg', { exact: true })).toBeVisible()
  await expect.poll(() => bluePixelCount(canvas)).toBeGreaterThan(200)
  await page.getByRole('radio', { name: /^Rückseite,/ }).check()
  await page.getByRole('button', { name: 'Kugelschreiber', exact: true }).click()
  await expect(scene).toHaveAttribute('data-product', 'pen')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(engraving).toBeChecked()
  await expect.poll(() => bluePixelCount(canvas)).toBeLessThan(5)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.cache/qa/pen-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('A5 notebook, full-color cover, saved zones and PNG', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?model=notebook')
  const scene = page.getByTestId('scene')
  const canvas = scene.locator('canvas')
  await expect(scene).toHaveAttribute('data-product', 'notebook')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-model-meshes', '2')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  await expect.poll(async () => Math.abs(Number(await scene.getAttribute('data-ground-gap')))).toBeLessThan(0.00001)
  await expect(page.getByRole('group', { name: 'Produkt', exact: true }).getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('radio')).toHaveCount(2)
  const cover = page.getByRole('radio', { name: /^Auf dem Einband, 100 × 150 mm/ })
  await expect(cover).toBeChecked()

  const rgb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><circle cx="105" cy="100" r="65" fill="#e84c35"/><circle cx="300" cy="100" r="65" fill="#20b878"/><circle cx="495" cy="100" r="65" fill="#2871de"/><text x="300" y="270" text-anchor="middle" font-family="sans-serif" font-size="100" font-weight="700">COLOR</text></svg>')
  await page.getByLabel('Logodatei', { exact: true }).setInputFiles({ name: 'color-logo.svg', mimeType: 'image/svg+xml', buffer: rgb })
  const greenPixels = () => canvas.evaluate((element: HTMLCanvasElement) => {
    const copy = document.createElement('canvas')
    copy.width = element.width
    copy.height = element.height
    const context = copy.getContext('2d')!
    context.drawImage(element, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 1] > data[index] + 40 && data[index + 1] > data[index + 2] + 20) count++
    }
    return count
  })
  await expect.poll(() => bluePixelCount(canvas)).toBeGreaterThan(200)
  await expect.poll(greenPixels).toBeGreaterThan(100)
  await scene.screenshot({ path: '.cache/qa/notebook-color.png' })
  await page.getByRole('radio', { name: 'Ohne Druck', exact: true }).check()
  await expect.poll(() => bluePixelCount(canvas)).toBeLessThan(5)
  await expect.poll(greenPixels).toBeLessThan(5)
  await scene.screenshot({ path: '.cache/qa/notebook-plain.png' })

  await page.getByRole('button', { name: 'Tasse', exact: true }).click()
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(page.getByText('color-logo.svg', { exact: true })).toBeVisible()
  await expect.poll(() => bluePixelCount(canvas)).toBeGreaterThan(200)
  await page.getByRole('button', { name: 'Notizbuch', exact: true }).click()
  await expect(scene).toHaveAttribute('data-product', 'notebook')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(page.getByRole('radio', { name: 'Ohne Druck', exact: true })).toBeChecked()
  await expect.poll(() => bluePixelCount(canvas)).toBeLessThan(5)
  await cover.check()
  await expect.poll(() => bluePixelCount(canvas)).toBeGreaterThan(200)

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PNG herunterladen' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('notebook-cover.png')
  const png = await readFile((await download.path())!)
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.length).toBeGreaterThan(20_000)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.cache/qa/notebook-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('German and English, logo drop, translated errors and preserved state', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('.glb')) modelRequests.push(request.url()) })
  await page.goto('/?model=notebook')
  const scene = page.getByTestId('scene')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.getByRole('button', { name: 'Deutsch', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Sprache', exact: true }).getByRole('button')).toHaveCount(2)

  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'dropped-logo.svg', { type: 'image/svg+xml' }))
    return data
  }, [...svg])
  await page.locator('.upload-area').dispatchEvent('dragenter', { dataTransfer: transfer })
  await expect(page.getByText('Logo hier ablegen', { exact: true })).toBeVisible()
  await page.locator('.upload-area').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(page.getByText('dropped-logo.svg', { exact: true })).toBeVisible()
  await expect.poll(() => bluePixelCount(scene.locator('canvas'))).toBeGreaterThan(200)
  await page.getByRole('radio', { name: 'Ohne Druck', exact: true }).check()
  await page.getByLabel('Logodatei', { exact: true }).setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await expect(page.getByRole('alert')).toContainText('Bitte wähle')
  const loadedRequests = modelRequests.length

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('alert')).toContainText('Please choose a PNG')
  await expect(page.getByRole('radio', { name: 'No print', exact: true })).toBeChecked()
  await expect(page.getByText('dropped-logo.svg', { exact: true })).toBeVisible()
  await expect(scene).toHaveAttribute('data-product', 'notebook')
  await expect.poll(() => bluePixelCount(scene.locator('canvas'))).toBeLessThan(5)
  expect(modelRequests).toHaveLength(loadedRequests)
  await expect(page.locator('body')).not.toContainText(/[А-Яа-яЁё]/)

  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  await expect(scene).toHaveAttribute('data-product', 'pen')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(page.getByRole('radio', { name: 'Beside the clip, 40 × 6 mm', exact: true })).toBeChecked()
  await expect(page.getByText('Laser engraving', { exact: true })).toBeVisible()
  await expect(page.getByText('dropped-logo.svg', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove logo', exact: true }).click()
  await expect(page.getByText('No logo', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore sample logo', exact: true }).click()
  await expect(page.getByText('Sample logo', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeEnabled()
})

test('aligned desktop panels and readable layouts in both languages', async ({ page }) => {
  await page.goto('/?model=mug')
  const scene = page.getByTestId('scene')
  await expect(scene).toHaveAttribute('data-model-ready', 'true')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
  for (const language of ['Deutsch', 'English']) {
    await page.getByRole('button', { name: language, exact: true }).click()
    for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      const viewport = (await scene.boundingBox())!
      const controls = (await page.locator('.controls').boundingBox())!
      if (size.width > 960) {
        expect(Math.abs(viewport.y - controls.y)).toBeLessThan(1)
        expect(Math.abs(viewport.height - controls.height)).toBeLessThan(1)
        // Panels grow with their controls; the document may scroll on a short screen.
        // No independent panel scroller or clipped controls should be introduced.
        expect(await page.locator('.controls').evaluate(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)).toBe(false)
      } else {
        expect(Math.abs(viewport.x - controls.x)).toBeLessThan(1)
        expect(Math.abs(viewport.width - controls.width)).toBeLessThan(1)
        expect(controls.y).toBeGreaterThanOrEqual(viewport.y + viewport.height - 1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      const clipped = await page.locator('.zone-name, .zone-size, .product-picker button span, .upload-copy').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent))
      expect(clipped).toEqual([])
      if (size.width <= 600) {
        for (const button of await page.locator('.language-picker button, .clear-logo, .reset-view, .save').all()) {
          expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        }
      }
    }
  }
})

test('flat products stay centered, show floor contact and limit tilt', async ({ page }) => {
  await page.goto('/?model=pen')
  const scene = page.getByTestId('scene')
  let shadowTexture = ''
  for (const product of [{ id: 'pen', label: 'Kugelschreiber' }, { id: 'notebook', label: 'Notizbuch' }, { id: 'pen', label: 'Kugelschreiber' }]) {
    await page.getByRole('button', { name: product.label, exact: true }).click()
    await expect(scene).toHaveAttribute('data-product', product.id)
    await expect(scene).toHaveAttribute('data-model-ready', 'true')
    await expect(scene).toHaveAttribute('data-renderer', /WebGL 2/)
    await scene.locator('canvas').evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const state = await page.evaluate(async () => {
      // Inspect the actual renderer used by the local Vite app.
      const source = await (await fetch('/src/Scene.tsx')).text()
      const fiber = source.match(/from\s*["']([^"']*@react-three_fiber[^"']*)["']/)![1]
      const three = source.match(/from\s*["']([^"']*\/three\.js[^"']*)["']/)![1]
      const { _roots } = await import(fiber)
      const { Box3 } = await import(three)
      const { scene, camera, gl, controls } = _roots.get(document.querySelector('[data-testid=scene] canvas')).store.getState()
      const root = scene.getObjectByName('GroundedProduct').children[0]
      const floor = scene.getObjectByName('StudioCyclorama')
      const contact = scene.getObjectByName('ProductContactShadow')
      const pixels = () => {
        const copy = document.createElement('canvas')
        copy.width = gl.domElement.width
        copy.height = gl.domElement.height
        const context = copy.getContext('2d')!
        context.drawImage(gl.domElement, 0, 0)
        return context.getImageData(0, 0, copy.width, copy.height).data
      }
      gl.render(scene, camera)
      const shadowed = pixels()
      let unshadowed: Uint8ClampedArray
      try {
        floor.receiveShadow = false
        contact.visible = false
        gl.render(scene, camera)
        unshadowed = pixels()
      } finally {
        floor.receiveShadow = true
        contact.visible = true
        gl.render(scene, camera)
      }
      let affected = 0
      let darkest = 0
      for (let index = 0; index < shadowed.length; index += 4) {
        const difference = (unshadowed[index] + unshadowed[index + 1] + unshadowed[index + 2] - shadowed[index] - shadowed[index + 1] - shadowed[index + 2]) / 3
        if (difference > 1) affected++
        darkest = Math.max(darkest, difference)
      }
      const pivot = root.worldToLocal(controls.target.clone()).multiplyScalar(1000)
      return { pivot: pivot.toArray(), target: controls.target.toArray(), floorY: new Box3().setFromObject(root, true).min.y, radius: camera.position.distanceTo(controls.target), coverage: affected / (shadowed.length / 4), darkest, texture: contact.children[0].material.map.uuid, alpha: shadowed[3] }
    })
    expect(Math.abs(state.pivot[0])).toBeLessThan(0.001)
    expect(Math.abs(state.pivot[2])).toBeLessThan(0.001)
    expect(state.floorY).toBeCloseTo(-1.35, 5)
    expect(state.radius).toBeCloseTo(12, 4)
    expect(state.darkest).toBeGreaterThan(20)
    expect(state.coverage).toBeGreaterThan(0.003)
    expect(state.coverage).toBeLessThan(0.15)
    expect(state.alpha).toBe(255)
    if (shadowTexture) expect(state.texture).toBe(shadowTexture)
    shadowTexture = state.texture

    const canvas = scene.locator('canvas')
    const box = (await canvas.boundingBox())!
    for (const gesture of [{ from: 0.85, to: 0.15, polar: Math.PI * 5 / 12 }, { from: 0.15, to: 0.85, polar: Math.PI / 12 }]) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * gesture.from)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * gesture.to, { steps: 8 })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(async () => {
        const source = await (await fetch('/src/Scene.tsx')).text()
        const { _roots } = await import(source.match(/from\s*["']([^"']*@react-three_fiber[^"']*)["']/)![1])
        const { controls } = _roots.get(document.querySelector('[data-testid=scene] canvas')).store.getState()
        return controls.getPolarAngle()
      })).toBeCloseTo(gesture.polar, 3)
    }
    const finalTarget = await page.evaluate(async () => {
      const source = await (await fetch('/src/Scene.tsx')).text()
      const { _roots } = await import(source.match(/from\s*["']([^"']*@react-three_fiber[^"']*)["']/)![1])
      return _roots.get(document.querySelector('[data-testid=scene] canvas')).store.getState().controls.target.toArray()
    })
    expect(finalTarget).toEqual(state.target)
    await page.getByRole('button', { name: 'Ansicht zurücksetzen', exact: true }).click()
  }
})

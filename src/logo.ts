import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { LabError } from './errors'
import type { LogoAsset, PrintZone, Product } from './types'

export function sampleLogo(colorful = false): LogoAsset {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 220
  const context = canvas.getContext('2d')!
  context.fillStyle = '#202326'
  context.textAlign = 'center'
  context.font = '700 190px Arial, sans-serif'
  if (colorful) {
    context.textAlign = 'left'
    let x = (640 - context.measureText('LOGO').width) / 2
    const colors = ['#379bd0', '#ec7848', '#8ecbd4', '#f1c16c']
    Array.from('LOGO').forEach((letter, index) => {
      context.fillStyle = colors[index]
      context.fillText(letter, x, 180)
      x += context.measureText(letter).width
    })
  } else context.fillText('LOGO', 320, 180)
  return { name: 'sample-logo', image: canvas, width: 640, height: 220, sample: true, colorfulSample: colorful }
}

export async function readLogo(file: File): Promise<LogoAsset> {
  if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
    throw new LabError('logoType')
  }
  if (file.size > 10 * 1024 * 1024) throw new LabError('logoSize')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new LabError('logoRead')
    if (image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new LabError('logoResolution')
    }
    return { name: file.name, image, width: image.naturalWidth, height: image.naturalHeight, sample: false }
  } catch (error) {
    if (error instanceof LabError) throw error
    throw new LabError('logoRead')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function createPrintTexture(product: Product) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(4096 * Math.min(1, product.texture.widthMm / product.texture.heightMm))
  canvas.height = Math.round(canvas.width * product.texture.heightMm / product.texture.widthMm)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  if (product.texture.wrap === 'u') texture.wrapS = RepeatWrapping
  else if (product.texture.wrap === 'v') texture.wrapT = RepeatWrapping
  return texture
}

export function drawPrintTexture(texture: CanvasTexture, product: Product, zone: PrintZone, logo: LogoAsset | null) {
  const canvas = texture.image as HTMLCanvasElement
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (logo && zone.id !== 'none') {
    const width = canvas.width * zone.widthMm / product.texture.widthMm
    const height = canvas.height * zone.heightMm / product.texture.heightMm
    const centerX = canvas.width * zone.textureCenter[0]
    const centerY = canvas.height * (1 - zone.textureCenter[1])
    const fit = Math.min(width / logo.width, height / logo.height)
    context.save()
    context.beginPath()
    context.rect(centerX - width / 2, centerY - height / 2, width, height)
    context.clip()
    context.drawImage(logo.image, centerX - logo.width * fit / 2, centerY - logo.height * fit / 2, logo.width * fit, logo.height * fit)
    if (product.printStyle === 'laser') {
      context.globalCompositeOperation = 'source-in'
      context.fillStyle = '#cbd0d6'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.restore()
  }
  texture.needsUpdate = true
}

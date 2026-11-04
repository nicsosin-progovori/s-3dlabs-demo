import mugSpec from '../models/mug/specification.json'
import mugGeometry from '../models/mug/geometry.json'
import penSpec from '../models/pen/specification.json'
import penGeometry from '../models/pen/geometry.json'
import notebookSpec from '../models/notebook/specification.json'
import notebookGeometry from '../models/notebook/geometry.json'
import type { ModelId, Product, ZoneId } from './types'

function modelUrl(path: string, hash: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}?v=${hash.slice(0, 12)}`
}

const penYaw = penSpec.poseYawDeg * Math.PI / 180
const penPivotAlong = penSpec.viewPivotFromTipMm - penSpec.lengthMm / 2
const notebookYaw = notebookSpec.poseYawDeg * Math.PI / 180
const notebookPivotAlong = notebookSpec.viewPivotFromBottomMm - notebookSpec.heightMm / 2

export const MUG: Product = {
  id: 'mug', label: 'Кружка',
  assetUrl: modelUrl(mugSpec.assetUrl, mugGeometry.glbSha256),
  dimensionMm: mugSpec.heightMm,
  displaySize: 2.7,
  defaultZone: mugSpec.defaultZone as ZoneId,
  printMeshName: mugSpec.printMeshName,
  printStyle: 'color',
  texture: { widthMm: mugGeometry.circumferenceMm, heightMm: mugSpec.heightMm, wrap: 'u' },
  viewElevation: 0.32,
  zones: mugSpec.zones.map((zone) => ({
    ...zone, id: zone.id as ZoneId,
    textureCenter: [0.5 - zone.angleDeg / 360, zone.centerHeightMm / mugSpec.heightMm],
  })),
}

export const PEN: Product = {
  id: 'pen', label: 'Ручка',
  assetUrl: modelUrl(penSpec.assetUrl, penGeometry.glbSha256),
  dimensionMm: penSpec.lengthMm,
  displaySize: 4.2,
  defaultZone: penSpec.defaultZone as ZoneId,
  printMeshName: penSpec.printMeshName,
  printStyle: 'laser',
  texture: { widthMm: penSpec.lengthMm, heightMm: penGeometry.circumferenceMm, wrap: 'v' },
  viewElevation: penSpec.viewElevation,
  orbitPivotMm: [penPivotAlong * Math.cos(penYaw), penSpec.bodyDiameterMm / 2, -penPivotAlong * Math.sin(penYaw)],
  maxCameraDistance: penSpec.maxCameraDistance,
  zones: penSpec.zones.map((zone) => ({
    ...zone, id: zone.id as ZoneId,
    textureCenter: [zone.centerLengthMm / penSpec.lengthMm, 0.5],
  })),
}

export const NOTEBOOK: Product = {
  id: 'notebook', label: 'Блокнот',
  assetUrl: modelUrl(notebookSpec.assetUrl, notebookGeometry.glbSha256),
  dimensionMm: notebookSpec.heightMm,
  displaySize: 3.2,
  defaultZone: notebookSpec.defaultZone as ZoneId,
  printMeshName: notebookSpec.printMeshName,
  printStyle: 'color',
  texture: { widthMm: notebookSpec.widthMm, heightMm: notebookSpec.heightMm, wrap: 'none' },
  viewElevation: notebookSpec.viewElevation,
  orbitPivotMm: [-notebookPivotAlong * Math.sin(notebookYaw), notebookGeometry.thicknessMm / 2, -notebookPivotAlong * Math.cos(notebookYaw)],
  zones: notebookSpec.zones.map((zone) => ({
    ...zone, id: zone.id as ZoneId,
    textureCenter: [0.5 + zone.centerXMm / notebookSpec.widthMm, 0.5 + zone.centerYMm / notebookSpec.heightMm],
  })),
}

export const PRODUCTS = [MUG, PEN, NOTEBOOK]

export const DEFAULT_ZONES = Object.fromEntries(PRODUCTS.map((product) => [product.id, product.defaultZone])) as Record<ModelId, ZoneId>

export function getProduct(id: ModelId): Product {
  return PRODUCTS.find((product) => product.id === id)!
}

export function getZone(product: Product, id: ZoneId) {
  return product.zones.find((zone) => zone.id === id) ?? product.zones.find((zone) => zone.id === product.defaultZone)!
}

import type { Group, Material, Mesh } from 'three'

export type ModelId = 'mug' | 'pen' | 'notebook'
export type ZoneId = 'none' | 'side-ts' | 'roundscreen' | 'front' | 'back' | 'opposite' | 'beside-clip' | 'cover'

export interface PrintZone {
  id: ZoneId
  label: string
  referenceLabel: string
  sizeLabel: string
  widthMm: number
  heightMm: number
  angleDeg: number
  textureCenter: [number, number]
}

export interface Product {
  id: ModelId
  label: string
  assetUrl: string
  dimensionMm: number
  displaySize: number
  defaultZone: ZoneId
  printMeshName: string
  printStyle: 'color' | 'laser'
  texture: { widthMm: number; heightMm: number; wrap: 'u' | 'v' | 'none' }
  viewElevation: number
  orbitPivotMm?: [number, number, number]
  maxCameraDistance?: number
  zones: PrintZone[]
}

export interface LogoAsset {
  name: string
  image: CanvasImageSource
  width: number
  height: number
  sample: boolean
  colorfulSample?: boolean
}

export interface LoadedModel {
  id: ModelId
  name: string
  root: Group
  originals: Map<Mesh, Material | Material[]>
  triangles: number
  meshCount: number
  fileSize: number
  dispose: () => void
}

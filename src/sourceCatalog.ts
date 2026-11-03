import bottleSpec from '../models/bottle/specification.json'
import endoSpec from '../models/endo/specification.json'
import pillowSpec from '../models/pillow/specification.json'
import bottleGeometry from '../models/bottle/geometry.json'
import endoGeometry from '../models/endo/geometry.json'
import pillowGeometry from '../models/pillow/geometry.json'
import type { Language } from './i18n'

export type SourceId = 'bottle' | 'endo' | 'pillow'
export type TechniqueId = 'laser' | 'pad' | 'screen' | 'digital' | 'laser360' | 'sublimation' | 'doming' | 'transfer' | 'reflective' | 'screen-transfer' | 'embroidery'
export type Text = Record<Language, string>
export interface SourceState { id: string; label: Text; hoverMm?: number; elevation: number }
export interface SourceColor { id: string; label: Text; hex: string; metalness?: number; roughness?: number; frame?: string }
export interface SourceZone {
  id: string; label: Text; surface: string; widthMm: number; heightMm: number
  surfaceWidthMm: number; surfaceHeightMm: number; center: [number, number]
  techniques: TechniqueId[]; azimuth: number; elevation?: number; wood?: boolean; circle?: boolean
}
export interface SourceProduct {
  id: SourceId; label: Text; code: string; size: string; source: string; assetUrl: string
  states: SourceState[]; colors: SourceColor[]; zones: SourceZone[]; defaultTechnique: TechniqueId
}

const text = (de: string, en: string): Text => ({ de, en })
const url = (id: SourceId, hash: string) => `${import.meta.env.BASE_URL}models/${id}/${id}.glb?v=${hash.slice(0, 12)}`

export const TECHNIQUES: Record<TechniqueId, { label: Text; maxColors?: number; kind: 'ink' | 'metal' | 'sublimation' | 'doming' | 'reflective' | 'thread' }> = {
  laser: { label: text('Lasergravur', 'Laser engraving'), kind: 'metal' },
  pad: { label: text('Tampondruck', 'Pad printing'), maxColors: 4, kind: 'ink' },
  screen: { label: text('Siebdruck', 'Screen printing'), maxColors: 1, kind: 'ink' },
  digital: { label: text('Digitaldruck', 'Digital printing'), kind: 'ink' },
  laser360: { label: text('Lasergravur 360°', '360° laser engraving'), kind: 'metal' },
  sublimation: { label: text('Sublimationsdruck', 'Sublimation'), kind: 'sublimation' },
  doming: { label: text('Doming', 'Doming'), kind: 'doming' },
  transfer: { label: text('Digitaltransfer', 'Digital transfer'), kind: 'ink' },
  reflective: { label: text('Reflextransfer', 'Reflective transfer'), maxColors: 1, kind: 'reflective' },
  'screen-transfer': { label: text('Siebtransfer', 'Screen transfer'), maxColors: 8, kind: 'ink' },
  embroidery: { label: text('Stickerei', 'Embroidery'), kind: 'thread' },
}

const hashes: Record<SourceId, string> = { bottle: bottleGeometry.glbSha256, endo: endoGeometry.glbSha256, pillow: pillowGeometry.glbSha256 }
export const SOURCE_PRODUCTS: SourceProduct[] = [bottleSpec, endoSpec, pillowSpec].map(raw => {
  const spec = raw as SourceProduct
  return { ...spec, assetUrl: url(spec.id, hashes[spec.id]) }
})

export function sourceProduct(id: SourceId) { return SOURCE_PRODUCTS.find(p => p.id === id)! }
export function isSourceId(id: string | null): id is SourceId { return SOURCE_PRODUCTS.some(p => p.id === id) }

export interface Decoration { zone: string; technique: TechniqueId; colors: number }
export interface SourceSettings { productId: SourceId; state: string; color: string; decoration: Decoration; enabled: boolean }
export function initialSettings(id: SourceId): SourceSettings {
  const p = sourceProduct(id)
  return { productId: id, state: p.states[0].id, color: p.colors[0].id, decoration: { zone: p.zones[0].id, technique: p.defaultTechnique, colors: 1 }, enabled: true }
}

export const sourceMessages = {
  de: {
    scene: 'Deine Produktkomposition', product: 'Produkt', product1: 'Produkt 1', product2: 'Produkt 2', add: 'Zweites Produkt hinzufügen', remove: 'Zweites Produkt entfernen',
    state: 'Zustand', color: 'Farbe', placement: 'Position', technique: 'Veredelung', colors: 'Druckfarben', fullColor: 'Vollfarbig', noPrint: 'Ohne Veredelung',
    actualBounds: 'Platzbedarf', layout: 'Automatisch platziert', source: 'Produktreferenz', legacy: 'Weitere Produkte', closedBox: 'Das Logo liegt in der geschlossenen Box.',
    upload: 'Logo hochladen', logo: 'Dein Logo', replace: 'Logo ersetzen', removeLogo: 'Logo entfernen', restore: 'Beispiellogo',
    loading: 'Modelle werden geladen…', error: 'Modell konnte nicht geladen werden.', retry: 'Erneut laden', download: 'PNG herunterladen', reset: 'Komposition einpassen',
    hint: 'Ziehen zum Drehen · Scrollen zum Zoomen', touch: 'Ziehen zum Drehen · Zwei Finger zum Zoomen', approx: 'Visueller Prototyp',
  },
  en: {
    scene: 'Your product composition', product: 'Product', product1: 'Product 1', product2: 'Product 2', add: 'Add second product', remove: 'Remove second product',
    state: 'State', color: 'Colour', placement: 'Placement', technique: 'Decoration', colors: 'Print colours', fullColor: 'Full colour', noPrint: 'No decoration',
    actualBounds: 'Space required', layout: 'Automatically arranged', source: 'Product reference', legacy: 'More products', closedBox: 'The logo is inside the closed box.',
    upload: 'Upload logo', logo: 'Your logo', replace: 'Replace logo', removeLogo: 'Remove logo', restore: 'Sample logo',
    loading: 'Loading models…', error: 'The model could not be loaded.', retry: 'Try again', download: 'Download PNG', reset: 'Fit composition',
    hint: 'Drag to rotate · Scroll to zoom', touch: 'Drag to rotate · Pinch to zoom', approx: 'Visual prototype',
  },
}

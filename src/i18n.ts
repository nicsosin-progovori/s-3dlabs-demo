import type { LabErrorCode } from './errors'
import type { ModelId, PrintZone, Product, ZoneId } from './types'

export type Language = 'de' | 'en'

const LANGUAGE_KEY='s3dlabs-language'
export function readLanguage():Language {
  try{return localStorage.getItem(LANGUAGE_KEY)==='en'?'en':'de'}
  catch{return 'de'}
}
export function persistLanguage(language:Language):void {
  try{localStorage.setItem(LANGUAGE_KEY,language)}catch{/* Language remains usable when storage is disabled. */}
}

interface Messages {
  language: string
  products: Record<ModelId, string>
  zones: Record<ZoneId, string>
  product: string
  logo: string
  placement: string
  controls: string
  scene: string
  upload: string
  drop: string
  formats: string
  logoFile: string
  logoPreview: string
  sample: string
  noLogo: string
  removeLogo: string
  restoreLogo: string
  loading: string
  download: string
  orbit: string
  zoom: string
  touch: string
  resetView: string
  laser: string
  color: string
  webgl: string
  description: string
  errors: Record<LabErrorCode, string>
}

export const messages: Record<Language, Messages> = {
  de: {
    language: 'Sprache',
    products: { mug: 'Tasse', pen: 'Kugelschreiber', notebook: 'Notizbuch' },
    zones: { none: 'Ohne Druck', 'side-ts': 'Rundum · groß', roundscreen: 'Rundum', front: 'Vorderseite', back: 'Rückseite', opposite: 'Gegenüber dem Henkel', 'beside-clip': 'Neben dem Clip', cover: 'Auf dem Einband' },
    product: 'Produkt', logo: 'Dein Logo', placement: 'Druckposition', controls: 'Produkt gestalten', scene: 'in 3D',
    upload: 'Logo hochladen', drop: 'Logo hier ablegen', formats: 'SVG, PNG, JPG, WebP · max. 10 MB',
    logoFile: 'Logodatei', logoPreview: 'Logo-Vorschau', sample: 'Beispiellogo', noLogo: 'Kein Logo', removeLogo: 'Logo entfernen', restoreLogo: 'Beispiellogo wiederherstellen',
    loading: 'Wird geladen…', download: 'PNG herunterladen', orbit: 'Ziehen zum Drehen', zoom: 'Scrollen zum Zoomen', touch: 'Drehen mit einem Finger · Zoom mit zwei', resetView: 'Ansicht zurücksetzen',
    laser: 'Lasergravur', color: 'Digitaldruck',
    webgl: 'Die 3D-Ansicht ist nicht verfügbar. Bitte aktiviere die Hardwarebeschleunigung in deinem Browser.',
    description: 'Dein Logo auf echten Produkten. In 3D gestalten und als PNG teilen.',
    errors: {
      logoType: 'Bitte wähle eine PNG-, JPG-, WebP- oder SVG-Datei.',
      logoSize: 'Dein Logo darf maximal 10 MB groß sein.',
      logoResolution: 'Bitte verwende ein Bild mit maximal 40 Megapixeln.',
      logoUpload: 'Das Logo konnte nicht auf unseren Server geladen werden. Bitte erneut versuchen.',
      logoRead: 'Das Logo konnte nicht geöffnet werden. Versuche es mit einer PNG-Datei mit transparentem Hintergrund.',
      modelExternal: 'Die Modelldatei ist unvollständig. Bitte verwende ein GLB mit eingebetteten Texturen.',
      modelCompression: 'Die Komprimierung dieses 3D-Modells wird noch nicht unterstützt.',
      modelRead: 'Das 3D-Modell konnte nicht geladen werden. Bitte lade die Seite neu.',
      modelEmpty: 'Die Datei enthält kein sichtbares 3D-Modell.',
      pngSave: 'Das PNG konnte nicht gespeichert werden. Bitte versuche es mit einer anderen Logodatei.',
    },
  },
  en: {
    language: 'Language',
    products: { mug: 'Mug', pen: 'Pen', notebook: 'Notebook' },
    zones: { none: 'No print', 'side-ts': 'Large wrap', roundscreen: 'Wraparound', front: 'Front', back: 'Back', opposite: 'Opposite the handle', 'beside-clip': 'Beside the clip', cover: 'On the cover' },
    product: 'Product', logo: 'Your logo', placement: 'Print placement', controls: 'Customize your product', scene: 'in 3D',
    upload: 'Upload your logo', drop: 'Drop your logo here', formats: 'SVG, PNG, JPG, WebP · max. 10 MB',
    logoFile: 'Logo file', logoPreview: 'Logo preview', sample: 'Sample logo', noLogo: 'No logo', removeLogo: 'Remove logo', restoreLogo: 'Restore sample logo',
    loading: 'Loading…', download: 'Download PNG', orbit: 'Drag to rotate', zoom: 'Scroll to zoom', touch: 'One finger to rotate · Two to zoom', resetView: 'Reset view',
    laser: 'Laser engraving', color: 'Digital print',
    webgl: 'The 3D view is unavailable. Please enable hardware acceleration in your browser.',
    description: 'Your logo on real products. Customize in 3D and share as a PNG.',
    errors: {
      logoType: 'Please choose a PNG, JPG, WebP or SVG file.',
      logoSize: 'Your logo must be 10 MB or smaller.',
      logoResolution: 'Please use an image of 40 megapixels or less.',
      logoUpload: 'The logo could not be uploaded to our server. Please try again.',
      logoRead: 'The logo could not be opened. Try a PNG with a transparent background.',
      modelExternal: 'The model file is incomplete. Please use a GLB with embedded textures.',
      modelCompression: 'This 3D model’s compression is not supported yet.',
      modelRead: 'The 3D model could not be loaded. Please reload the page.',
      modelEmpty: 'The file does not contain a visible 3D model.',
      pngSave: 'The PNG could not be saved. Please try a different logo file.',
    },
  },
}

export function zoneSize(product: Product, zone: PrintZone) {
  if (zone.id === 'none') return ''
  const dimensions = product.id === 'mug' ? [zone.heightMm, zone.widthMm] : [zone.widthMm, zone.heightMm]
  return `${dimensions.join(' × ')} mm`
}

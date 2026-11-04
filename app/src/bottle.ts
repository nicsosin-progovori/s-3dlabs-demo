import type { Language } from './i18n'
import { sourceProduct } from './sourceCatalog'
import type { TechniqueId, Text } from './sourceCatalog'
import type { BottleView } from './bottleViews'
export {BOTTLE_VIEWS,bottleCamera} from './bottleViews'
export type {BottleState,BottleView,CameraView} from './bottleViews'
const text=(de:string,en:string):Text=>({de,en})
export const BOTTLE=sourceProduct('bottle')
export const VIEW_LABELS: Record<BottleView,Text>={
  overview:text('Hero','Hero'), front:text('Korpus','Body'), profile:text('Dreiviertel','Three-quarter'),
  branding:text('Logo','Logo'), shoulder:text('Schulter','Shoulder'),
  lid:text('Deckel','Lid'), back:text('Rückseite','Back'),
  neck:text('Öffnung','Opening'), top:text('Von oben','Top'),
}
export const BOTTLE_METHODS:Record<'body'|'lid',TechniqueId[]>={
  body:['laser','pad','screen','digital','laser360','sublimation'],
  lid:['laser','pad','doming'],
}
export function bottleZone(surface:'body'|'lid',technique:TechniqueId) {
  return BOTTLE.zones.find(z=>z.surface===surface&&z.techniques.includes(technique))!
}
const descriptions:Record<TechniqueId,Text>={
  laser:text('Helle Metallgravur ohne die Originalfarben.','Light silver engraving, without logo colours.'),
  pad:text('Oberflächendruck mit 1–4 Druckfarben.','1–4 spot colours on the surface.'),
  screen:text('Einfarbiger Druck um die Flasche.','A single-colour print around the bottle.'),
  digital:text('Vollfarbiger Rundumdruck, glatte Oberfläche.','Full-colour wrap print, smooth surface.'),
  laser360:text('Helle Rundumgravur ohne die Originalfarben.','Silver wrap engraving, without logo colours.'),
  sublimation:text('Vollfarbig; optisch ähnlich wie Digitaldruck.','Full colour; can look similar to digital print.'),
  doming:text('Erhabener, glänzender Farbaufkleber.','Raised, glossy label with a full-colour logo.'),
  transfer:text('Vollfarbiger Transfer.','Full-colour transfer.'),
  reflective:text('Silberner, reflektierender Transfer.','Silver reflective transfer.'),
  'screen-transfer':text('Transfer mit Druckfarben.','Spot-colour transfer.'),
  embroidery:text('Stickerei mit sichtbarer Fadenstruktur.','Embroidery with a visible thread texture.'),
}
export function methodDescription(technique:TechniqueId,surface:string,language:Language) {
  if(technique==='laser'&&surface==='lid')return text('Dunkle Gravur; Bambusmaserung bleibt sichtbar.','Dark engraving; bamboo grain stays visible.')[language]
  return descriptions[technique][language]
}
export const bottleText={
  de:{title:'Isolierflasche',subtitle:'500 ml · Edelstahl & Bambus',state:'Zustand',color:'Farbe',logo:'Dein Logo',branding:'Veredelung',location:'Position',body:'Flasche',lid:'Bambusdeckel',method:'Verfahren',none:'Ohne Logo',views:'Ansichten',free:'Freie Ansicht',reset:'Gesamtansicht',area:'Druckfläche',colors:'Druckfarben',download:'PNG herunterladen',closed:'Stehend',open:'Deckel ab',lying:'Liegend',remove:'Logo entfernen',restore:'Beispiellogo',sample:'Farbiges Beispiellogo',formats:'SVG, PNG, JPG, WebP · max. 10 MB',source:'Produktdetails',loading:'Flasche wird geladen…',retry:'Erneut laden',hide:'Kein Logo auf der Flasche. Deine Datei bleibt erhalten.',upload:'Eigenes Logo hochladen',replace:'Logo ersetzen',scene:'Isolierflasche in 3D',opening:'Deckel wird abgenommen…',closing:'Flasche wird geschlossen…',laying:'Flasche wird hingelegt…',standing:'Flasche wird aufgerichtet…',closeLay:'Schließen und hinlegen…',standOpen:'Aufrichten und öffnen…'},
  en:{title:'Insulated bottle',subtitle:'500 ml · Stainless steel & bamboo',state:'State',color:'Colour',logo:'Your logo',branding:'Decoration',location:'Placement',body:'Bottle body',lid:'Bamboo lid',method:'Method',none:'No logo',views:'Views',free:'Free view',reset:'Overview',area:'Print area',colors:'Print colours',download:'Download PNG',closed:'Standing',open:'Lid removed',lying:'Lying down',remove:'Remove logo',restore:'Restore sample logo',sample:'Colour sample logo',formats:'SVG, PNG, JPG, WebP · max. 10 MB',source:'Product details',loading:'Loading bottle…',retry:'Try again',hide:'No logo on the bottle. Your file is kept.',upload:'Upload your logo',replace:'Replace logo',scene:'Insulated bottle in 3D',opening:'Removing the lid…',closing:'Closing the bottle…',laying:'Laying the bottle down…',standing:'Standing the bottle up…',closeLay:'Closing and laying down…',standOpen:'Standing up and opening…'},
}

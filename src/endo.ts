import metadata from '../models/endo/rig-v02.json'
import { sourceProduct } from './sourceCatalog'
import type { Text } from './sourceCatalog'
import type { EndoState } from './endoMotion'
import type { EndoView } from './endoViews'
const text=(de:string,en:string):Text=>({de,en})
export const ENDO={...sourceProduct('endo'),assetUrl:`${import.meta.env.BASE_URL}models/endo/endo-rig-v02.glb?v=${metadata.glbSha256.slice(0,12)}`}
export const ENDO_STATE_LABELS:Record<EndoState,Text>={
  'box-closed':text('Box geschlossen','Box closed'),'box-open':text('Box geöffnet','Box open'),flat:text('Ausgebreitet','Laid out'),wrist:text('Armbandform','Wrist shape'),
}
export const ENDO_VIEW_LABELS:Record<EndoView,Text>={
  overview:text('Hero','Hero'),top:text('Von oben','Top'),profile:text('Dreiviertel','Three-quarter'),branding:text('Logo','Logo'),sensor:text('Sensor','Sensor'),buckle:text('Verschluss','Buckle'),fabric:text('Gewebe & Logo','Fabric & logo'),package:text('Verpackung','Packaging'),
}
export const endoText={
  de:{title:'Endo Tracker',subtitle:'Textilarmband · XD Collection',scene:'Endo Tracker in 3D',state:'Zustand',colour:'Farbe',logo:'Dein Logo',branding:'Veredelung',method:'Verfahren',none:'Ohne Logo',views:'Ansichten',free:'Freie Ansicht',reset:'Gesamtansicht',area:'Druckfläche',colours:'Druckfarben',download:'PNG herunterladen',remove:'Logo entfernen',restore:'Beispiellogo',sample:'Farbiges Beispiellogo',upload:'Eigenes Logo hochladen',replace:'Logo ersetzen',formats:'SVG, PNG, JPG, WebP · max. 10 MB',loading:'Tracker wird geladen…',retry:'Erneut laden',source:'Produktdetails',hidden:'Das Logo befindet sich in der geschlossenen Box.',laser:'Helle Gravur auf der vorderen Metallleiste.',pad:'Tampondruck mit 1–4 Druckfarben.',hide:'Kein Logo. Deine Datei bleibt erhalten.',open:'Box wird geöffnet / geschlossen…',extract:'Armband wird ausgepackt / eingelegt…',wrap:'Armband wird geformt / ausgebreitet…',queued:'Nächstes Ziel',moving:'Bewegung läuft…'},
  en:{title:'Endo tracker',subtitle:'Textile wristband · XD Collection',scene:'Endo tracker in 3D',state:'State',colour:'Colour',logo:'Your logo',branding:'Decoration',method:'Method',none:'No logo',views:'Views',free:'Free view',reset:'Overview',area:'Print area',colours:'Print colours',download:'Download PNG',remove:'Remove logo',restore:'Restore sample logo',sample:'Colour sample logo',upload:'Upload your logo',replace:'Replace logo',formats:'SVG, PNG, JPG, WebP · max. 10 MB',loading:'Loading tracker…',retry:'Try again',source:'Product details',hidden:'The logo is inside the closed box.',laser:'Light engraving on the front metal bar.',pad:'Pad printing with 1–4 spot colours.',hide:'No logo. Your file is kept.',open:'Opening / closing the box…',extract:'Unpacking / packing the wristband…',wrap:'Wrapping / laying out the wristband…',queued:'Next target',moving:'Moving…'},
}

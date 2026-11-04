import { ACESFilmicToneMapping, BasicShadowMap, Color, Matrix3, SRGBColorSpace, Vector3 } from 'three'
import type { CSSProperties } from 'react'
import type { SceneSettings } from '../shared/sceneContract.mjs'

function freeze<T extends object>(value:T):T {
  Object.values(value).forEach(v=>{if(v&&typeof v==='object')freeze(v)})
  return Object.freeze(value)
}

/** One photographic rig for every product, pose and camera. */
export const STUDIO_LOOK=freeze({
  id:'source-studio-v01',exposure:1,toneMapping:ACESFilmicToneMapping,shadowType:BasicShadowMap,
  background:{top:'#dfd9d2',bottom:'#eae5df'},
  ambient:.18,hemisphere:{intensity:.35,sky:'#fffdf7',ground:'#c1b7aa'},
  key:{position:[-3.8,6.3,4.2],intensity:1.7,color:'#fff8ed'},
  fill:{position:[4,3,-4],intensity:.25,color:'#f5f7ff'},
  environment:{resolution:512,intensity:1,surround:'#42413e',boxes:[
    {position:[-3.8,.4,4.5],scale:[3.5,7.5],intensity:5,color:'#fff8ec'},
    {position:[4,0,-1],scale:[1.4,6.5],intensity:3.4,color:'#f6f8ff'},
    {position:[0,6,0],scale:[5,4],intensity:2.1,color:'#ffffff'},
    {position:[-1,0,7],scale:[5,6],intensity:.65,color:'#ffffff'},
  ]},
  shadow:{radius:2.8,contact:.22,opacity:.48,density:1,frames:48,resolution:2048,position:[1,.002,0]},
  ao:{resolutionScale:1,intensity:.5,radius:.23,thickness:.05,samples:16},
  revealMs:180,
})

export type StudioLook=typeof STUDIO_LOOK&{
  key:typeof STUDIO_LOOK.key&{target?:number[]}
  fill:typeof STUDIO_LOOK.fill&{target?:number[]}
  shadow:typeof STUDIO_LOOK.shadow&Partial<Omit<SceneSettings['shadow'],keyof typeof STUDIO_LOOK.shadow>>
  shadowMap?:SceneSettings['shadowMap']
}

// Exact inverse of the pinned Three.js ACES output transform. The CSS loading
// surface and the HDR sweep therefore share the same displayed endpoint colours.
const input=new Matrix3().set(.59719,.35458,.04823,.076,.90834,.01566,.0284,.13383,.83777)
const output=new Matrix3().set(1.60475,-.53108,-.07367,-.10208,1.10813,-.00605,-.00327,-.07276,1.07602)
export function studioRadiance(hex:string,exposure=STUDIO_LOOK.exposure):Vector3 {
  const c=new Color(hex),v=new Vector3(c.r,c.g,c.b).applyMatrix3(output.clone().invert())
  const inverse=(y:number)=>{const a=.983729*y-1,b=.432951*y-.0245786,c=.238081*y+.000090537;return (-b-Math.sqrt(b*b-4*a*c))/(2*a)}
  return new Vector3(inverse(v.x),inverse(v.y),inverse(v.z)).applyMatrix3(input.clone().invert()).multiplyScalar(.6/exposure)
}
export function studioDisplay(radiance:Vector3,exposure=STUDIO_LOOK.exposure):Color {
  const v=radiance.clone().multiplyScalar(exposure/.6).applyMatrix3(input)
  const fit=(x:number)=>(x*(x+.0245786)-.000090537)/(x*(.983729*x+.432951)+.238081)
  v.set(fit(v.x),fit(v.y),fit(v.z)).applyMatrix3(output)
  return new Color(Math.max(0,Math.min(1,v.x)),Math.max(0,Math.min(1,v.y)),Math.max(0,Math.min(1,v.z)))
}
export function studioBackdropRadiance(verticalUv:number,look:StudioLook=STUDIO_LOOK):Vector3 {
  return studioRadiance(look.background.bottom,look.exposure).lerp(studioRadiance(look.background.top,look.exposure),Math.max(0,Math.min(1,verticalUv)))
}
export function studioBackdropHex(verticalUv:number,look:StudioLook=STUDIO_LOOK){return '#'+studioDisplay(studioBackdropRadiance(verticalUv,look),look.exposure).getHexString(SRGBColorSpace)}
export const STUDIO_BACKGROUND_CSS='linear-gradient(180deg,'+Array.from({length:9},(_,i)=>studioBackdropHex(1-i/8)+' '+(i*12.5)+'%').join(',')+')'
export const STUDIO_STYLE={
  '--studio-background-top':STUDIO_LOOK.background.top,
  '--studio-background-bottom':STUDIO_LOOK.background.bottom,
  '--studio-background':STUDIO_BACKGROUND_CSS,
  '--studio-reveal-duration':STUDIO_LOOK.revealMs+'ms',
} as CSSProperties

export function studioStyleFor(look:StudioLook):CSSProperties{
  return {'--studio-background-top':look.background.top,'--studio-background-bottom':look.background.bottom,'--studio-background':'linear-gradient(180deg,'+Array.from({length:9},(_,i)=>studioBackdropHex(1-i/8,look)+' '+(i*12.5)+'%').join(',')+')','--studio-reveal-duration':look.revealMs+'ms'} as CSSProperties
}
export const studioStageSignature=(look:StudioLook=STUDIO_LOOK)=>JSON.stringify(look)

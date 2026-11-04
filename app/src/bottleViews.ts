export type BottleState='closed'|'open'|'lying'
export type BottleView='overview'|'front'|'profile'|'branding'|'shoulder'|'lid'|'back'|'neck'|'top'
export interface CameraView {
  id:string
  request:number
  azimuth:number
  elevation:number
  fov?:number
  roll?:number
  subject?:[number,number]
  margin?:number
  focusMm?:{min:[number,number,number];max:[number,number,number]}
  frameTarget?:'composition'|'primary'
  projection?:{near:number;far:number;zoom:number}
  absolute?:{position:[number,number,number];target:[number,number,number];fov:number;roll:number;near:number;far:number;zoom:number}
}
export const BOTTLE_VIEWS:Record<BottleState,BottleView[]>={
  closed:['overview','front','profile','branding'],
  open:['overview','front','top','branding'],
  lying:['overview','profile','top','branding'],
}
export const bottleViews=(state:BottleState,surface:string):BottleView[]=>surface==='lid'?['overview','top','branding']:BOTTLE_VIEWS[state]

/** Product advertising frames always face the selected decoration surface.
 * The original ImageGen directions remain in art-direction/bottle-cameras.
 * Elevation is rise/run; roll is degrees. Geometry and artwork stay fixed. */
export function bottleCamera(state:BottleState,view:BottleView,surface:string,request:number):CameraView {
  const base:CameraView={id:view,request,azimuth:24,elevation:-.05,fov:26,roll:-2,subject:[.12,-.015],margin:.95}
  if(state==='open')Object.assign(base,{azimuth:-18,elevation:.32,roll:0,subject:[.04,-.02],margin:.94})
  if(state==='lying')Object.assign(base,{azimuth:-25,elevation:.28,fov:30,roll:-25,subject:[.02,-.02],margin:.93})
  if(surface==='lid'){
    if(view==='overview')return {...base,azimuth:state==='lying'?50:0,elevation:state==='lying'?.50:state==='open'?.50:1.0,roll:state==='lying'?-25:state==='open'?0:-2,margin:1.01}
    if(view==='top')return {...base,azimuth:state==='lying'?35:0,elevation:.65,fov:26,roll:state==='lying'?-90:0,subject:[0,0],margin:1.08,focusMm:state==='lying'?{min:[120,4,-33],max:[214,69,33]}:state==='open'?{min:[10,-1,-30],max:[104,88,42]}:{min:[-35,120,-35],max:[35,213,35]}}
    const focus={
      closed:{min:[-29,177,-29],max:[29,213,29]},
      open:{min:[43,-1,-17],max:[102,51,41]},
      lying:{min:[160,6,-25],max:[211,64,25]},
    } as const
    return {...base,azimuth:state==='lying'?35:0,elevation:state==='lying'?.35:.65,fov:26,roll:state==='lying'?-90:0,subject:state==='open'?[.14,-.015]:[0,0],margin:1.06,focusMm:{min:[...focus[state].min],max:[...focus[state].max]}}
  }
  if(view==='branding')return {...base,azimuth:state==='lying'?-8:state==='open'?-12:0,elevation:state==='lying'?.10:.04,fov:24,roll:state==='lying'?-90:state==='open'?3:0,subject:[0,-.02],margin:1.01,focusMm:state==='lying'?{min:[30,8,-38],max:[122,67,38]}:{min:[-35,30,-38],max:[35,126,38]}}
  if(view==='shoulder')return {...base,azimuth:state==='lying'?32:30,elevation:state==='lying'?.6:.48,fov:26,roll:state==='lying'?-16:-5,subject:[0,-.015],margin:.99,focusMm:state==='lying'?{min:[139,8,-31],max:[211,65,31]}:{min:[-30,149,-30],max:[30,213,30]}}
  if(view==='front')return {...base,azimuth:0,elevation:.10,fov:24,roll:0,subject:[0,-.015],margin:1.04,focusMm:{min:[-35,28,-38],max:[35,168,38]}}
  if(view==='profile')return {...base,azimuth:state==='lying'?0:-42,elevation:state==='lying'?.18:.20,fov:26,roll:state==='lying'?0:-15,subject:state==='lying'?[0,-.015]:[-.04,-.015],margin:1.02,...(state==='lying'?{focusMm:{min:[18,8,-38] as [number,number,number],max:[150,67,38] as [number,number,number]}}:{})}
  if(view==='neck')return {...base,azimuth:32,elevation:.72,fov:26,roll:6,subject:[0,-.02],margin:.99,focusMm:{min:[-26,155,-26],max:[26,193,26]}}
  if(view==='top')return {...base,azimuth:state==='open'?-12:12,elevation:state==='open'?1.10:1.35,fov:26,roll:state==='open'?-12:28,subject:[.02,-.02],margin:.98}
  // Retained for callers that saved the former rear view; no extra UI button.
  if(view==='back')return {...base,azimuth:155,elevation:.14,fov:24,roll:8,subject:[-.10,-.02]}
  return base
}

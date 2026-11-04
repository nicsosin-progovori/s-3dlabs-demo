import { Box3, MathUtils, Vector3 } from 'three'
import { bottleFrame } from './bottleCameraMotion.ts'
import { ENDO_STATES, endoIndex, endoMaterialPoint, endoPose } from './endoMotion.ts'
import type { EndoPose, EndoState } from './endoMotion.ts'

export type EndoView='overview'|'top'|'profile'|'branding'|'sensor'|'buckle'|'fabric'|'package'
export interface EndoViewRequest {id:EndoView;state:EndoState;serial:number}
export const ENDO_VIEWS:Record<EndoState,EndoView[]>={
  'box-closed':['overview'],
  'box-open':['overview','top','branding','fabric'],
  flat:['overview','top','profile','branding'],
  wrist:['overview','profile','branding','fabric'],
}
const heroes=[
  {azimuth:32,elevation:.85,fov:28,roll:-7},
  {azimuth:30,elevation:1.05,fov:28,roll:-5},
  {azimuth:-18,elevation:1.25,fov:28,roll:-12},
  {azimuth:34,elevation:.26,fov:26,roll:-7},
]

function localBox(pose:EndoPose,centre:Vector3,half:Vector3) {
  const box=new Box3()
  for(const x of [-half.x,half.x])for(const y of [-half.y,half.y])for(const z of [-half.z,half.z])box.expandByPoint(new Vector3(x,y,z).add(centre).applyQuaternion(pose.rotation).add(pose.position))
  return box
}

export function endoFocus(pose:EndoPose,state:EndoState,view:EndoView) {
  if(view==='top'&&state==='box-open')return new Box3(new Vector3(-.0715,0,-.042),new Vector3(.0715,.022,.042))
  if(view==='top'&&state==='flat')return localBox(pose,new Vector3(0,0,.006),new Vector3(.014,.007,.060))
  if(view==='profile'&&state==='flat')return localBox(pose,new Vector3(0,0,-.015),new Vector3(.014,.007,.090))
  if(view==='profile'&&state==='wrist')return localBox(pose,new Vector3(0,.001,0),new Vector3(.016,.008,.024))
  if(view==='branding')return localBox(pose,new Vector3(0,.004,.0185),new Vector3(.014,.003,.007))
  if(view==='fabric')return localBox(pose,new Vector3(0,.003,.021),new Vector3(.014,.005,.012))
  if(view==='sensor')return localBox(pose,new Vector3(0,-.0045,-.001),new Vector3(.010,.002,.012))
  if(view==='buckle'){
    const buckle=endoMaterialPoint(pose.points,pose.angles,.100),box=new Box3()
    for(const x of [-.016,.016])for(const y of [-.003,.003])for(const z of [-.009,.009])box.expandByPoint(new Vector3(x,y,z).applyAxisAngle(new Vector3(1,0,0),buckle.angle).add(buckle.point).applyQuaternion(pose.rotation).add(pose.position))
    return box
  }
  if(view==='package'&&state==='box-closed')return new Box3(new Vector3(-.0715,.006,.018),new Vector3(-.025,.019,.042))
  return pose.frameBounds.clone()
}

export function endoCameraParameters(state:EndoState,view:EndoView) {
  const p={...heroes[endoIndex(state)],margin:1.05,subject:[.025,-.01] as [number,number]}
  if(view==='top')Object.assign(p,{azimuth:state==='flat'?0:20,elevation:7,fov:28,roll:state==='flat'?-28:-12})
  if(view==='profile')Object.assign(p,{azimuth:state==='wrist'?-42:state==='flat'?35:45,elevation:state==='wrist'?.22:state==='flat'?.75:.25,roll:state==='wrist'?8:state==='flat'?-5:3})
  if(view==='branding')Object.assign(p,{azimuth:state==='wrist'?16:90,elevation:state==='wrist'?.15:2.4,fov:27,roll:0,margin:1.1,subject:[0,0]})
  if(view==='sensor')Object.assign(p,{azimuth:128,elevation:.22,fov:28,roll:-8,margin:1.15,subject:[0,0]})
  if(view==='buckle')Object.assign(p,{azimuth:state==='wrist'?188:65,elevation:state==='wrist'?.18:1.8,fov:28,roll:-8,margin:1.1,subject:[0,0]})
  if(view==='fabric')Object.assign(p,{azimuth:state==='wrist'?-28:-20,elevation:state==='wrist'?.50:1.1,fov:26,roll:state==='wrist'?-20:-8,margin:1.05,subject:[0,0]})
  if(view==='package')Object.assign(p,{azimuth:-35,elevation:state==='box-closed'?.6:1.45,fov:29,roll:-10,subject:[0,0]})
  return p
}

export function endoCameraFrame(state:EndoState,view:EndoView,width:number,height:number,pose=endoPose(endoIndex(state))) {
  const p=endoCameraParameters(state,view)
  return bottleFrame(endoFocus(pose,state,view),p.azimuth,p.elevation,width,height,p)
}

/** A continuous camera rail indexed by the same physical coordinate as the rig. */
export function endoMotionFrame(pose:EndoPose,width:number,height:number) {
  const q=pose.coordinate,a=Math.min(2,Math.floor(q)),b=a+1,t=MathUtils.smootherstep(q-a,0,1)
  const p=heroes[a],next=heroes[b]
  if(Number.isInteger(q))return endoCameraFrame(ENDO_STATES[q],'overview',width,height,pose)
  return bottleFrame(pose.frameBounds,MathUtils.lerp(p.azimuth,next.azimuth,t),MathUtils.lerp(p.elevation,next.elevation,t),width,height,{fov:MathUtils.lerp(p.fov,next.fov,t),roll:MathUtils.lerp(p.roll,next.roll,t),margin:1.05,subject:[.025,-.01]})
}

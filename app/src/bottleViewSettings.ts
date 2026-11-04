import type {BottleRig} from './bottleMotion.ts'
import {bottleFrame} from './bottleCameraMotion.ts'
import type {BottleState,CameraView} from './bottleViews.ts'
import type {CameraViewCatalog} from '../shared/cameraViewsContract.mjs'
import type {CameraSettings} from '../shared/renderContract.mjs'
import {bottleViewBounds} from './bottleComposition.ts'
import {DEFAULT_COMPOSITION} from '../shared/compositionContract.mjs'
import type {Composition} from '../shared/compositionContract.mjs'

export interface BottleViewCamera {id:string;label:{de:string;en:string};camera:CameraSettings}
/** Generic object framing only; this is not a hidden copy of the view catalogue. */
export function automaticBottleView(request=0):CameraView{
  return {id:'automatic',request,azimuth:24,elevation:.32,fov:28,roll:0,subject:[0,0],margin:1.12,projection:{near:.025,far:100,zoom:1}}
}
export function cameraStateFor(catalog:CameraViewCatalog|null,state:BottleState,surface:'body'|'lid'='body'){return (surface==='lid'?catalog?.lidStates?.[state]:null)??catalog?.states[state]}
export function cameraRequestFor(catalog:CameraViewCatalog|null,state:BottleState,request:number,id?:string,surface:'body'|'lid'='body'):CameraView{
  const data=cameraStateFor(catalog,state,surface),entry=data?.views.find(view=>view.id===(id??data.defaultView))
  if(!entry)return automaticBottleView(request)
  const {near,far,zoom,...frame}=entry.camera
  return {...frame,id:entry.id,request,projection:{near,far,zoom}}
}
export function cameraViewsFor(catalog:CameraViewCatalog|null,rig:BottleRig,state:BottleState,size:{width:number;height:number},composition:Composition=DEFAULT_COMPOSITION,surface:'body'|'lid'='body'):BottleViewCamera[]{
  if(!catalog)return []
  return cameraStateFor(catalog,state,surface)!.views.map(entry=>{
    const preset=entry.camera,bounds=bottleViewBounds(rig,state,preset,composition)
    const frame=bottleFrame(bounds,preset.azimuth,preset.elevation,size.width,size.height,preset)
    return {id:entry.id,label:{...entry.label},camera:{position:frame.position.toArray(),target:frame.target.toArray(),fov:frame.fov??preset.fov,roll:frame.roll??preset.roll,near:preset.near,far:preset.far,zoom:preset.zoom}}
  })
}

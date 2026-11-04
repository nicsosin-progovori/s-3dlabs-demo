import {Box3,Euler,Matrix4,Quaternion,Vector3} from 'three'
import type {Composition,CompositionTransform} from '../shared/compositionContract.mjs'

export interface CompositionFrame {position:Vector3;target:Vector3;fov:number;roll:number}
export interface FrameOptions {fov?:number;roll?:number;margin?:number;subject?:[number,number];safeArea?:[number,number];zoom?:number}
export interface FrameElement {id:string;bounds:Box3;matrix?:Matrix4;visible?:boolean}
const DEG=Math.PI/180
export function transformMatrix(transform:CompositionTransform):Matrix4{
  return new Matrix4().compose(new Vector3(...transform.position),new Quaternion().setFromEuler(new Euler(...transform.rotation.map(n=>n*DEG) as [number,number,number],'XYZ')),new Vector3(...transform.scale))
}
export function compositionMatrices(composition:Composition){
  const root=transformMatrix(composition.root)
  return composition.elements.filter(e=>e.visible).map(element=>({element,matrix:root.clone().multiply(transformMatrix(element.transform))}))
}
/** Explicit participants only: never traverse the studio floor, lights or helpers. */
export function compositionBounds(elements:readonly FrameElement[]):Box3{
  const box=new Box3()
  for(const element of elements){
    if(element.visible===false)continue
    if(element.bounds.isEmpty())continue
    const bounds=element.bounds.clone()
    if(element.matrix)bounds.applyMatrix4(element.matrix)
    if([...bounds.min.toArray(),...bounds.max.toArray()].some(n=>!Number.isFinite(n)))throw Error('Invalid composition bounds')
    box.union(bounds)
  }
  if(box.isEmpty())throw Error('Composition has no visible bounded elements')
  return box
}
export function transformCompositionBounds(bounds:Box3,composition:Composition):Box3{
  return compositionBounds(compositionMatrices(composition).map(({element,matrix})=>({id:element.id,bounds,matrix})))
}
function axes(direction:Vector3,roll=0){
  const right=new Vector3(direction.z,0,-direction.x).normalize(),up=new Vector3().crossVectors(direction,right).normalize()
  right.applyAxisAngle(direction,roll*DEG);up.applyAxisAngle(direction,roll*DEG)
  return {right,up}
}
export function compositionFitDistance(box:Box3,target:Vector3,direction:Vector3,width:number,height:number,options:FrameOptions):number{
  const {right,up}=axes(direction,options.roll)
  const tan=Math.tan((options.fov??35)*Math.PI/360)/(options.zoom??1),aspect=width/Math.max(1,height),[horizontalLimit,usable]=options.safeArea??[.84,Math.max(.48,1-70/Math.max(1,height))],[sx,sy]=options.subject??[0,0]
  let distance=.6
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new Vector3(x,y,z).sub(target),depth=p.dot(direction),horizontal=p.dot(right)/(tan*aspect),vertical=p.dot(up)/tan
    distance=Math.max(distance,(horizontal+horizontalLimit*depth)/(horizontalLimit-sx),(-horizontal+horizontalLimit*depth)/(horizontalLimit+sx),(vertical+usable*depth)/(usable-sy),(-vertical+usable*depth)/(usable+sy))
  }
  return distance*(options.margin??1.12)
}
/** Bounds are already in world units; there is no product, origin or GLB assumption. */
export function compositionFrame(box:Box3,azimuth:number,elevation:number,width:number,height:number,options:FrameOptions={}):CompositionFrame{
  if(box.isEmpty()||[...box.min.toArray(),...box.max.toArray()].some(n=>!Number.isFinite(n)))throw Error('Invalid composition frame')
  const target=box.getCenter(new Vector3()),yaw=azimuth*DEG,direction=new Vector3(Math.sin(yaw),elevation,Math.cos(yaw)).normalize()
  const [requestedX,sy]=options.subject??[0,0],sx=requestedX*Math.min(1,width/Math.max(1,height)/1.5)**3
  const distance=compositionFitDistance(box,target,direction,width,height,{...options,subject:[sx,sy]}),tan=Math.tan((options.fov??35)*Math.PI/360)/(options.zoom??1),{right,up}=axes(direction,options.roll)
  target.addScaledVector(right,-sx*distance*tan*width/Math.max(1,height)).addScaledVector(up,-sy*distance*tan)
  return {target,position:target.clone().addScaledVector(direction,distance),fov:options.fov??35,roll:options.roll??0}
}

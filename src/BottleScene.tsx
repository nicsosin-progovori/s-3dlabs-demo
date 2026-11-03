import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { DecoratedModel } from './SourceScene'
import { StudioStage } from './StudioStage'
import type { LayoutReport, StudioItem } from './SourceScene'
import { configureSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import { BOTTLE } from './bottle'
import type { BottleState, CameraView } from './bottle'
import { applyBottlePose, BOTTLE_BASE_PIVOT, BOTTLE_SCALE, bottleMotionDuration, bottleMotionEnvelope, bottlePoseBounds, createBottleRig, sampleBottlePose } from './bottleMotion'
import type { BottleMotionRequest } from './bottleMotion'
import { bottleCameraTransition, bottleCameraUp, bottleFrame, bottleOrbitLimits } from './bottleCameraMotion'
import type { BottleFrame } from './bottleCameraMotion'
import { studioCameraDuration, studioCameraFrame, studioCameraMove, studioReducedMotion } from './studioCameraMotion'
import type { StudioCameraMove } from './studioCameraMotion'
import type { Composition } from '../shared/compositionContract.mjs'
import { transformCompositionBounds } from './compositionCamera'
import { bottleViewBounds } from './bottleComposition'
import type { BottleRig } from './bottleMotion'

export interface BottleMotionSnapshot {
  id:number; from:BottleState; to:BottleState; active:boolean; progress:number; phase:string; durationMs:number; actionDurationMs:number; framingDurationMs:number
  angle:number; bodyPosition:number[]; lidCentre:number[]; bodyFloorMm:number; lidFloorMm:number; bounds:number[][]; frames:number
}
interface Props {
  item?:StudioItem; view:CameraView; motion:BottleMotionRequest|null
  cameraEnabled?:boolean
  renderModel?:SourceModel
  composition?:Composition
  onInteraction?:(active:boolean)=>void
  onReady:(save:(filename:string)=>void,renderer:string)=>void; fallback:string
  onLayout:(report:LayoutReport)=>void; onCamera:(snapshot:object)=>void; onMotion:(snapshot:BottleMotionSnapshot)=>void; onInteract:()=>void
}
const ignoreSelect=()=>{}

export function BottleAssembly({item,view,motion,onLayout,onCamera,onMotion,onInteract,cameraEnabled=true,renderModel,onInteraction,composition}:Omit<Props,'item'|'onReady'|'fallback'>&{item:StudioItem}) {
  const {gl,camera,size,get,invalidate}=useThree()
  const state=item.settings.state as BottleState
  const rig=useMemo(()=>createBottleRig(item.model.root),[item.model])
  // Geometry can improve without replacing the pose timeline or camera controller.
  const visualRig=useMemo(()=>renderModel&&renderModel!==item.model?createBottleRig(renderModel.root):rig,[renderModel,item.model,rig])
  const renderedModel=useMemo(()=>({root:visualRig.root,productId:'bottle',dispose:()=>{}}),[visualRig])
  const renderedItem=useMemo(()=>({...item,model:renderedModel}),[item,renderedModel])
  const destination=useMemo(()=>{
    const pose=sampleBottlePose(rig,state,state,1),bounds=bottlePoseBounds(rig,pose)
    return {bounds,position:new Vector3(state==='lying'?BOTTLE_BASE_PIVOT:0,0,0)}
  },[rig,state])
  const timeline=useMemo(()=>{
    const from=motion?.from??state,to=motion?.to??state
    const actionDuration=motion&&!studioReducedMotion()?bottleMotionDuration(from,to):0
    const pose=sampleBottlePose(rig,from,to,actionDuration?0:1),bounds=bottlePoseBounds(rig,pose),envelope=motion?bottleMotionEnvelope(rig,motion):destination.bounds
    let lead=0
    if(actionDuration){
      camera.updateMatrixWorld()
      const frameBounds=composition?transformCompositionBounds(bounds,composition):bounds
      const cropped=[frameBounds.min.x,frameBounds.max.x].some(x=>[frameBounds.min.y,frameBounds.max.y].some(y=>[frameBounds.min.z,frameBounds.max.z].some(z=>{const p=new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera);return Math.abs(p.x)>.98||Math.abs(p.y)>.9})))
      const orbit=get().controls as unknown as {target:Vector3}|null
      if(cropped&&orbit){
        const start={position:camera.position.clone(),target:orbit.target.clone(),fov:camera instanceof PerspectiveCamera?camera.fov:28}
        const wide=bottleFrame(composition?transformCompositionBounds(envelope,composition):envelope,to==='open'?-12:to==='lying'?18:26,to==='open'?.55:.46,size.width,size.height,{fov:Math.min(view.fov??35,24)})
        lead=Math.min(.85,Math.max(.60,studioCameraDuration(start,wide)*.8))
      }
    }
    const duration=actionDuration+lead
    return {request:motion,from,to,duration,actionDuration,lead,elapsed:0,active:duration>0,progress:duration?0:1,start:motion?.startedAt??performance.now(),pose,bounds,envelope,frames:0,lastReport:0}
  // A colour / logo update must not restart the motion clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[rig,motion?.id,state,composition])
  const reportMotion=()=>{
    const body=bottlePoseBounds(rig,timeline.pose,'body'),lid=bottlePoseBounds(rig,timeline.pose,'lid')
    onMotion({id:timeline.request?.id??0,from:timeline.from,to:timeline.to,active:timeline.active,progress:timeline.progress,phase:timeline.elapsed<timeline.lead?'framing':timeline.pose.phase,durationMs:Math.round(timeline.duration*1000),actionDurationMs:Math.round(timeline.actionDuration*1000),framingDurationMs:Math.round(timeline.lead*1000),angle:timeline.pose.angle,bodyPosition:timeline.pose.position.toArray(),lidCentre:lid.getCenter(new Vector3()).toArray(),bodyFloorMm:body.min.y*1000,lidFloorMm:lid.min.y*1000,bounds:[timeline.bounds.min.toArray(),timeline.bounds.max.toArray()],frames:timeline.frames})
  }
  useLayoutEffect(()=>{
    configureSourceModel(renderedModel,BOTTLE,{...item.settings,state:'closed'})
    invalidate()
  },[renderedModel,item.settings.color,invalidate])
  useLayoutEffect(()=>{
    applyBottlePose(rig,timeline.pose)
    if(visualRig!==rig)applyBottlePose(visualRig,timeline.pose)
    gl.shadowMap.needsUpdate=true
    reportMotion();invalidate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[timeline,visualRig])
  useLayoutEffect(()=>{
    onLayout({items:[{key:0,sizeMm:destination.bounds.getSize(new Vector3()).multiplyScalar(1000).toArray().map(Math.round),min:destination.bounds.min.toArray(),max:destination.bounds.max.toArray()}],gapMm:0,axis:[1,0,0]})
  },[destination,onLayout])
  useFrame(()=>{
    if(!timeline.active)return
    const now=performance.now()
    timeline.elapsed=(now-timeline.start)/1000
    timeline.progress=studioReducedMotion()?1:Math.max(0,Math.min(1,(timeline.elapsed-timeline.lead)/timeline.actionDuration))
    timeline.pose=sampleBottlePose(rig,timeline.from,timeline.to,timeline.progress)
    applyBottlePose(rig,timeline.pose)
    if(visualRig!==rig)applyBottlePose(visualRig,timeline.pose)
    timeline.bounds=bottlePoseBounds(rig,timeline.pose);timeline.frames++
    timeline.active=timeline.progress<1;gl.shadowMap.needsUpdate=true
    if(!timeline.active||now-timeline.lastReport>70){timeline.lastReport=now;reportMotion()}
    if(timeline.active)invalidate()
  },-2)
  return <>
    <group scale={BOTTLE_SCALE}><DecoratedModel item={renderedItem} position={[0,0,0]} onSelect={ignoreSelect}/></group>
    {cameraEnabled&&<BottleCamera view={view} timeline={timeline} destination={destination} rig={rig} state={state} composition={composition} onCamera={onCamera} onInteract={onInteract} onInteraction={onInteraction}/>}
  </>
}
type Timeline={request:BottleMotionRequest|null;from:BottleState;to:BottleState;duration:number;lead:number;elapsed:number;active:boolean;progress:number;bounds:Box3;envelope:Box3}
function BottleCamera({view,timeline,destination,onCamera,onInteract,onInteraction,rig,state,composition}:{view:CameraView;timeline:Timeline;destination:{bounds:Box3;position:Vector3};onCamera:Props['onCamera'];onInteract:Props['onInteract'];onInteraction?:Props['onInteraction'];rig:BottleRig;state:BottleState;composition?:Composition}) {
  const {camera,size,invalidate}=useThree()
  const controls=useRef<ComponentRef<typeof OrbitControls>>(null),initialized=useRef(false)
  const lastMotionReport=useRef(0)
  const displayRoll=useRef(0)
  const cinematic=useRef<{start:BottleFrame;lead?:StudioCameraMove}|null>(null),change=useRef<{plan:StudioCameraMove;started:number}|null>(null)
  const box=useMemo(()=>composition?bottleViewBounds(rig,state,view,composition):view.focusMm?new Box3(new Vector3(...view.focusMm.min).multiplyScalar(.001).add(destination.position),new Vector3(...view.focusMm.max).multiplyScalar(.001).add(destination.position)):destination.bounds,[view,destination,composition,rig,state])
  const currentBounds=()=>composition?transformCompositionBounds(timeline.bounds,composition):timeline.bounds
  const goal=useMemo(()=>view.absolute?{position:new Vector3(...view.absolute.position),target:new Vector3(...view.absolute.target),fov:view.absolute.fov,roll:view.absolute.roll}:bottleFrame(box,view.azimuth,view.elevation,size.width,size.height,{...view,zoom:view.projection?.zoom}),[box,view,size.width,size.height])
  const wide=useMemo(()=>bottleFrame(composition?transformCompositionBounds(timeline.envelope,composition):timeline.envelope,timeline.to==='open'?-12:timeline.to==='lying'?18:26,timeline.to==='open'?.55:.46,size.width,size.height,{fov:Math.min(view.fov??35,24)}),[timeline,view.fov,size.width,size.height,composition])
  const report=(moving=false)=>{
    const orbit=controls.current
    if(!orbit)return
    applyFilmRoll()
    camera.updateMatrixWorld()
    const projected:number[][]=[]
    const measured=timeline.active?currentBounds():box
    for(const x of [measured.min.x,measured.max.x])for(const y of [measured.min.y,measured.max.y])for(const z of [measured.min.z,measured.max.z])projected.push(new Vector3(x,y,z).multiplyScalar(BOTTLE_SCALE).project(camera).toArray())
    onCamera({position:camera.position.toArray(),target:orbit.target.toArray(),projected,moving,request:view.request,viewId:view.id,fov:camera instanceof PerspectiveCamera?camera.fov:35,roll:displayRoll.current})
  }
  const applyFilmRoll=()=>{
    const orbit=controls.current
    if(!orbit)return
    camera.up.copy(bottleCameraUp({position:camera.position,target:orbit.target,roll:displayRoll.current}))
    camera.lookAt(orbit.target)
    // Roll belongs to the photograph. OrbitControls must retain the physical
    // world's vertical axis and its above-floor polar limit while dragging.
    camera.up.set(0,1,0)
  }
  const apply=(frame:BottleFrame)=>{
    const orbit=controls.current!
    if(camera instanceof PerspectiveCamera&&camera.fov!==(frame.fov??35)){camera.fov=frame.fov??35;camera.updateProjectionMatrix()}
    const limits=bottleOrbitLimits(frame)
    orbit.maxDistance=limits.maxDistance;orbit.maxPolarAngle=limits.maxPolarAngle
    camera.position.copy(frame.position);orbit.target.copy(frame.target);camera.up.set(0,1,0)
    displayRoll.current=frame.roll??0;applyFilmRoll()
  }
  useLayoutEffect(()=>{
    const orbit=controls.current
    if(!orbit||!(camera instanceof PerspectiveCamera))return
    const projection=view.absolute??view.projection
    if(projection){camera.near=projection.near;camera.far=projection.far;camera.zoom=projection.zoom;camera.updateProjectionMatrix()}
    const limits=bottleOrbitLimits(goal)
    orbit.maxDistance=limits.maxDistance;orbit.maxPolarAngle=limits.maxPolarAngle
    const start={position:camera.position.clone(),target:orbit.target.clone(),fov:camera instanceof PerspectiveCamera?camera.fov:35,roll:displayRoll.current}
    orbit.enableDamping=false;orbit.enabled=!timeline.active
    if(!initialized.current||studioReducedMotion()){
      apply(goal);initialized.current=true;cinematic.current=null;change.current=null;orbit.enableDamping=true;report()
    }else if(timeline.active){
      const previous=change.current
      const lead=timeline.lead?studioCameraMove(start,wide,{previous:previous?.plan,elapsed:previous?(performance.now()-previous.started)/1000:undefined,duration:timeline.lead}):undefined
      cinematic.current={start:lead?wide:start,lead};change.current=null;report(true)
    }
    else {
      const now=performance.now(),previous=change.current
      const plan=studioCameraMove(start,goal,{previous:previous?.plan,elapsed:previous?(now-previous.started)/1000:undefined})
      change.current=plan.duration?{plan,started:now}:null;cinematic.current=null
      if(!change.current){apply(goal);orbit.enableDamping=true}report(!!change.current)
    }
    invalidate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view.request,size.width,size.height,timeline])
  useFrame(()=>{
    const orbit=controls.current
    if(!orbit)return
    if(cinematic.current){
      const t=timeline.progress
      const lead=cinematic.current.lead
      apply(lead&&timeline.elapsed<timeline.lead?studioCameraFrame(lead,timeline.elapsed/timeline.lead):bottleCameraTransition(cinematic.current.start,wide,goal,t,currentBounds(),size.width,size.height))
      if(t>=1){cinematic.current=null;orbit.enabled=true;orbit.enableDamping=true;report()}
      else {if(performance.now()-lastMotionReport.current>70){lastMotionReport.current=performance.now();report(true)}invalidate()}
    }else if(change.current){
      const now=performance.now(),t=studioReducedMotion()?1:Math.min(1,(now-change.current.started)/(change.current.plan.duration*1000))
      apply(studioCameraFrame(change.current.plan,t))
      if(t>=1){change.current=null;orbit.enableDamping=true;report()}
      else {if(now-lastMotionReport.current>100){lastMotionReport.current=now;report(true)}invalidate()}
    }else applyFilmRoll()
  },-.5)
  const limits=bottleOrbitLimits(goal)
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={.6} maxDistance={limits.maxDistance} minPolarAngle={.08} maxPolarAngle={limits.maxPolarAngle} rotateSpeed={.65} dampingFactor={.13} onStart={()=>{if(timeline.active)return;onInteraction?.(true);change.current=null;cinematic.current=null;controls.current!.enableDamping=true;onInteract()}} onEnd={()=>{onInteraction?.(false);if(!timeline.active&&!change.current)report()}}/>
}
export function BottleScene({item,...props}:Props) {
  const [moving,setMoving]=useState(false)
  const onMotion=props.onMotion
  const stageMotion=useCallback((snapshot:BottleMotionSnapshot)=>{setMoving(snapshot.active);onMotion(snapshot)},[onMotion])
  return <StudioStage ready={!!item} moving={moving} shadowKey={`${item?.model.root.uuid}:${item?.settings.state}:${props.motion?.id??0}`} onReady={props.onReady} fallback={props.fallback}>{item&&<BottleAssembly key={item.model.root.uuid} item={item} {...props} onMotion={stageMotion}/>}</StudioStage>
}

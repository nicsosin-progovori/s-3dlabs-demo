import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PerspectiveCamera, Vector3 } from 'three'
import { StudioStage } from './StudioStage'
import { DecoratedModel } from './SourceScene'
import type { StudioItem } from './SourceScene'
import { configureSourceModel } from './sourceModel'
import { ENDO } from './endo'
import { applyEndoPose, createEndoRig, ENDO_SCALE, ENDO_STATES, endoActualStrapLength, endoPose, EndoTimeline } from './endoMotion'
import type { EndoRig, EndoState } from './endoMotion'
import { endoCameraFrame, endoFocus, endoMotionFrame } from './endoViews'
import type { EndoViewRequest } from './endoViews'
import { bottleCameraUp, bottleOrbitLimits } from './bottleCameraMotion'
import type { BottleFrame } from './bottleCameraMotion'
import { studioCameraFrame, studioCameraMove, studioReducedMotion } from './studioCameraMotion'
import type { StudioCameraMove } from './studioCameraMotion'

export interface EndoMotionSnapshot {
  id:number;epoch:number;target:EndoState;anchor:EndoState;coordinate:number;active:boolean;phase:string
  frames:number;elapsedMs:number;strapLengthMm:number;groundMm:number;boxVisible:boolean;bounds:number[][]
}
interface Props {
  item?:StudioItem;request:{id:number;to:EndoState};view:EndoViewRequest
  onReady:(save:(filename:string)=>void,renderer:string)=>void;fallback:string
  onMotion:(snapshot:EndoMotionSnapshot)=>void;onCamera:(snapshot:object)=>void;onInteract:()=>void
}

export function EndoAssembly({item,request,view,onMotion,onCamera,onInteract}:Omit<Props,'item'|'onReady'|'fallback'>&{item:StudioItem}) {
  const {gl,scene,invalidate}=useThree()
  const rig=useMemo(()=>createEndoRig(item.model.root),[item.model])
  const timeline=useMemo(()=>new EndoTimeline(item.settings.state as EndoState),[item.model])
  const lastReport=useRef(0)
  const report=(now:number)=>onMotion({id:timeline.id,epoch:timeline.epoch,target:ENDO_STATES[timeline.target],anchor:ENDO_STATES[timeline.anchor],coordinate:timeline.coordinate,active:timeline.active,phase:rig.pose.phase,frames:timeline.frames,elapsedMs:timeline.frames?Math.round((now-timeline.started)*1000):0,strapLengthMm:endoActualStrapLength(rig)*1000,groundMm:rig.pose.trackerBounds.min.y*1000,boxVisible:rig.box.visible,bounds:[rig.pose.frameBounds.min.toArray(),rig.pose.frameBounds.max.toArray()]})
  useLayoutEffect(()=>{
    configureSourceModel(item.model,ENDO,item.settings)
    // Reuse the accepted studio's material-cache invalidation protocol, after
    // the child's decoration material has been installed.
    scene.userData.bottleDecorationVersion=(scene.userData.bottleDecorationVersion??0)+1
    gl.domElement.dataset.shadowFrames='0';invalidate()
  },[item.model,item.settings.color,item.settings.enabled,item.settings.decoration.technique,item.settings.decoration.colors,item.logo,scene,gl,invalidate])
  useLayoutEffect(()=>{
    const now=performance.now()/1000
    timeline.request(request.to,request.id,now,studioReducedMotion())
    applyEndoPose(rig,endoPose(timeline.coordinate));gl.shadowMap.needsUpdate=true
    report(now);invalidate()
  // A palette / logo update must not restart the shared motion clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[request.id,rig,timeline])
  useFrame(()=>{
    if(!timeline.active)return
    const now=performance.now()/1000
    if(studioReducedMotion())timeline.request(ENDO_STATES[timeline.target],timeline.id,now,true)
    timeline.sample(now);applyEndoPose(rig,endoPose(timeline.coordinate));gl.shadowMap.needsUpdate=true
    if(!timeline.active||now-lastReport.current>.10){lastReport.current=now;report(now)}
    if(timeline.active)invalidate()
  },-2)
  return <>
    <group scale={ENDO_SCALE}><DecoratedModel item={item} position={[0,0,0]} onSelect={()=>{}}/></group>
    <EndoCamera rig={rig} timeline={timeline} view={view} onCamera={onCamera} onInteract={onInteract}/>
  </>
}

function EndoCamera({rig,timeline,view,onCamera,onInteract}:{rig:EndoRig;timeline:EndoTimeline;view:EndoViewRequest;onCamera:Props['onCamera'];onInteract:Props['onInteract']}) {
  const {camera,size,invalidate}=useThree(),controls=useRef<ComponentRef<typeof OrbitControls>>(null)
  const initialized=useRef(false),epoch=useRef(-1),wasActive=useRef(false),roll=useRef(0),lastReport=useRef(0),reportedCoordinate=useRef<number|null>(null)
  const lead=useRef<StudioCameraMove|null>(null),change=useRef<{plan:StudioCameraMove;time:number}|null>(null)
  const goal=useMemo(()=>endoCameraFrame(view.state,view.id,size.width,size.height),[view,size.width,size.height])
  const currentFrame=():BottleFrame=>({position:camera.position.clone(),target:controls.current!.target.clone(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current})
  const filmRoll=()=>{if(controls.current){camera.up.copy(bottleCameraUp(currentFrame()));camera.lookAt(controls.current.target);camera.up.set(0,1,0)}}
  const apply=(frame:BottleFrame)=>{
    const orbit=controls.current!
    if(camera instanceof PerspectiveCamera){camera.fov=frame.fov??28;camera.updateProjectionMatrix()}
    const limits=bottleOrbitLimits(frame);orbit.maxDistance=limits.maxDistance;orbit.maxPolarAngle=limits.maxPolarAngle
    camera.position.copy(frame.position);orbit.target.copy(frame.target);camera.up.set(0,1,0)
    roll.current=frame.roll??0;filmRoll()
  }
  const report=(moving:boolean)=>{
    if(!controls.current)return
    reportedCoordinate.current=timeline.coordinate
    filmRoll();camera.updateMatrixWorld()
    const box=timeline.active?rig.pose.frameBounds:endoFocus(rig.pose,view.state,view.id),projected:number[][]=[]
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.push(new Vector3(x,y,z).multiplyScalar(ENDO_SCALE).project(camera).toArray())
    onCamera({position:camera.position.toArray(),target:controls.current.target.toArray(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current,moving,viewId:timeline.active?'motion':view.id,serial:view.serial,projected,coordinate:timeline.coordinate})
  }
  useLayoutEffect(()=>{
    if(!controls.current)return
    if(!initialized.current||studioReducedMotion()){apply(goal);initialized.current=true;change.current=null;controls.current.enableDamping=true;report(false)}
    else {
      const now=performance.now()/1000,previous=change.current,plan=studioCameraMove(currentFrame(),goal,{previous:previous?.plan,elapsed:previous?now-previous.time:undefined})
      change.current=plan.duration?{plan,time:now}:null;controls.current.enableDamping=!change.current
      if(!change.current)apply(goal);report(!!change.current)
    }
    invalidate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view.serial,size.width,size.height])
  useFrame(()=>{
    const orbit=controls.current;if(!orbit)return
    const now=performance.now()/1000
    orbit.enabled=!timeline.active
    if(timeline.active){
      orbit.enableDamping=false
      if(epoch.current!==timeline.epoch){
        epoch.current=timeline.epoch
        const previous=change.current,plan=studioCameraMove(currentFrame(),endoMotionFrame(rig.pose,size.width,size.height),{previous:previous?.plan,elapsed:previous?now-previous.time:undefined})
        const duration=Math.max(.12,plan.duration)
        timeline.edgeStart+=duration-timeline.lead;timeline.lead=duration
        lead.current=plan;change.current=null
      }
      change.current=null
      const t=Math.min(1,(now-timeline.started)/timeline.lead),frame=endoMotionFrame(rig.pose,size.width,size.height)
      apply(t<1&&lead.current?studioCameraFrame(lead.current,t):frame)
      if(now-lastReport.current>.10){lastReport.current=now;report(true)}
      wasActive.current=true;invalidate()
    }else if(wasActive.current){apply(endoMotionFrame(rig.pose,size.width,size.height));wasActive.current=false;lead.current=null;orbit.enableDamping=true;report(false)}
    else if(change.current){
      const t=studioReducedMotion()?1:Math.min(1,(now-change.current.time)/change.current.plan.duration)
      apply(studioCameraFrame(change.current.plan,t))
      if(t===1){change.current=null;orbit.enableDamping=true;report(false)}else {if(now-lastReport.current>.10){lastReport.current=now;report(true)}invalidate()}
    }else {filmRoll();if(reportedCoordinate.current!==timeline.coordinate)report(false)}
  },-.5)
  const limits=bottleOrbitLimits(goal)
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={.4} maxDistance={limits.maxDistance} minPolarAngle={.08} maxPolarAngle={limits.maxPolarAngle} dampingFactor={.13} rotateSpeed={.65} onStart={()=>{if(timeline.active)return;change.current=null;controls.current!.enableDamping=true;onInteract()}} onEnd={()=>{if(!timeline.active&&!change.current)report(false)}}/>
}

export function EndoScene({item,...props}:Props) {
  const [moving,setMoving]=useState(false),[epoch,setEpoch]=useState(0)
  const outerMotion=props.onMotion
  const onMotion=useCallback((next:EndoMotionSnapshot)=>{setMoving(next.active);setEpoch(next.epoch);outerMotion(next)},[outerMotion])
  return <StudioStage ready={!!item} moving={moving} shadowKey={`endo:${item?.model.root.uuid}:${epoch}`} onReady={props.onReady} fallback={props.fallback}>
    {item&&<EndoAssembly item={item} {...props} onMotion={onMotion}/>}
  </StudioStage>
}

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Box3, Group, MathUtils, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { BOTTLE } from './bottle'
import { ENDO } from './endo'
import { applyBottlePose, bottleMotionDuration, bottleMotionEnvelope, bottlePoseBounds, createBottleRig, sampleBottlePose } from './bottleMotion'
import type { BottleRig } from './bottleMotion'
import type { BottleState } from './bottleViews'
import { applyEndoPose, createEndoRig, endoIndex, EndoTimeline } from './endoMotion'
import type { EndoRig, EndoState } from './endoMotion'
import { createPillowSubject } from './pillowViews'
import { PillowDecoration } from './PillowScene'
import { DecoratedModel } from './SourceScene'
import type { LayoutReport, StudioItem } from './SourceScene'
import type { SourceModel } from './sourceModel'
import { configureSourceModel } from './sourceModel'
import { studioInstance } from './studioInstance'
import { bottleCameraUp, bottleOrbitLimits } from './bottleCameraMotion'
import type { BottleFrame } from './bottleCameraMotion'
import { studioCameraFrame, studioCameraMove, studioReducedMotion } from './studioCameraMotion'
import type { StudioCameraMove } from './studioCameraMotion'
import { PAIR_SCALE, pairBounds, pairCameraFrame, pairEndoBounds, placePair, reservePair } from './pairLayout'
import type { PairView } from './pairLayout'

interface Subject {model:SourceModel;rendered:SourceModel;bottle?:BottleRig;endo?:EndoRig;pillow?:ReturnType<typeof createPillowSubject>;yaw:number}
export interface PairMotionSnapshot {id:number;active:boolean;phase:'rest'|'spacing'|'motion'|'settling';progress:number;gapMm:number;states:string[]}
interface Props {items:[StudioItem,StudioItem];view:{id:PairView;serial:number};onMotion:(next:PairMotionSnapshot)=>void;onLayout:(next:LayoutReport)=>void;onCamera:(next:object)=>void;onInteract:()=>void;onSelect:(slot:number)=>void}
interface Motion {id:number;from:string[];to:string[];phase:'spacing'|'motion'|'settling';started:number;duration:number;positionsFrom:Vector3[];reserved:Vector3[];final:Vector3[];wide:Box3;finalBounds:Box3;envelopes:Box3[];endo:(EndoTimeline|null)[];bottleDurations:number[];progress:number}
const smooth=(t:number)=>MathUtils.smootherstep(MathUtils.clamp(t,0,1),0,1)

function subject(source:SourceModel):Subject {
  const model=studioInstance(source)
  if(source.productId==='bottle'){
    const bottle=createBottleRig(model.root)
    return {model,bottle,rendered:{...model,root:bottle.root},yaw:0}
  }
  if(source.productId==='endo')return {model,rendered:model,endo:createEndoRig(model.root),yaw:0}
  return {model,rendered:model,pillow:createPillowSubject(model.root),yaw:-Math.PI/3}
}
const pillowBounds=(s:Subject)=>s.pillow!.full.clone().applyMatrix4(new Matrix4().makeRotationY(s.yaw))
function endpoint(s:Subject,state:string,slot:number) {
  if(s.bottle)return bottlePoseBounds(s.bottle,sampleBottlePose(s.bottle,state as BottleState,state as BottleState,1))
  if(s.endo)return pairEndoBounds(endoIndex(state as EndoState),slot).frame
  return pillowBounds(s)
}
function envelope(s:Subject,from:string,to:string,slot:number) {
  if(s.bottle){const box=bottleMotionEnvelope(s.bottle,{id:1,from:from as BottleState,to:to as BottleState});return {frame:box,collision:box}}
  if(s.endo){const frame=new Box3(),collision=new Box3(),a=endoIndex(from as EndoState),b=endoIndex(to as EndoState)
    for(let i=0;i<=96;i++){const pose=pairEndoBounds(MathUtils.lerp(a,b,i/96),slot);frame.union(pose.frame);collision.union(pose.collision)}
    return {frame:frame.expandByScalar(.003),collision:collision.expandByScalar(.003)}
  }
  return {frame:pillowBounds(s),collision:pillowBounds(s)}
}
function apply(s:Subject,state:string,slot:number,from=state,progress=1,coordinate?:number) {
  if(s.bottle){const pose=sampleBottlePose(s.bottle,from as BottleState,state as BottleState,progress);applyBottlePose(s.bottle,pose);return bottlePoseBounds(s.bottle,pose)}
  if(s.endo){const b=pairEndoBounds(coordinate??endoIndex(state as EndoState),slot);applyEndoPose(s.endo,b.pose);if(slot===1)s.endo.box.position.x=-b.pose.boxPosition.x;s.endo.root.updateMatrixWorld(true);return b.frame}
  return pillowBounds(s)
}
function supportPoints(subjects:Subject[],boxes:Box3[],positions:Vector3[]) {
  return subjects.flatMap((s,i)=>{
    if(s.pillow)return s.pillow.fullSupport.map(p=>p.clone().applyAxisAngle(new Vector3(0,1,0),s.yaw).add(positions[i]))
    const box=boxes[i],points:Vector3[]=[]
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new Vector3(x,y,z).add(positions[i]))
    return points
  })
}

function Actor({item,subject:s,onSelect}:{item:StudioItem;subject:Subject;onSelect:(slot:number)=>void}) {
  const {scene,gl,invalidate}=useThree(),rendered=useMemo(()=>({...item,model:s.rendered}),[item,s])
  useLayoutEffect(()=>{
    if(item.settings.productId!=='pillow')configureSourceModel(s.rendered,item.settings.productId==='bottle'?BOTTLE:ENDO,{...item.settings,state:item.settings.productId==='bottle'?'closed':item.settings.state})
    scene.userData.bottleDecorationVersion=(scene.userData.bottleDecorationVersion??0)+1;gl.domElement.dataset.shadowFrames='0';invalidate()
  },[s,item.settings.color,item.settings.enabled,item.settings.decoration.technique,item.settings.decoration.colors,item.logo,scene,gl,invalidate])
  return item.settings.productId==='pillow'?<group rotation={[0,s.yaw,0]} onClick={e=>{e.stopPropagation();onSelect(item.key)}}><PillowDecoration item={rendered}/></group>:<DecoratedModel item={rendered} position={[0,0,0]} onSelect={onSelect}/>
}

/** One metre convention, two independent rigs and one continuous camera. */
export function PairScene({items,view,onMotion,onLayout,onCamera,onInteract,onSelect}:Props) {
  const {camera,size,gl,invalidate}=useThree(),controls=useRef<ComponentRef<typeof OrbitControls>>(null)
  const subjects=useMemo(()=>items.map(i=>subject(i.model)),[items[0].model,items[1].model])
  useEffect(()=>()=>subjects.forEach(s=>s.model.dispose()),[subjects])
  const groups=useRef<(Group|null)[]>([null,null]),positions=useRef([new Vector3(),new Vector3()]),boxes=useRef<Box3[]>([])
  const initialized=useRef(false),states=useRef(items.map(i=>i.settings.state)),motion=useRef<Motion|null>(null),move=useRef<{plan:StudioCameraMove;started:number}|null>(null),sequence=useRef(0),roll=useRef(0),lastReport=useRef(0)
  const callbacks=useRef({onMotion,onLayout,onCamera,onInteract});callbacks.current={onMotion,onLayout,onCamera,onInteract}
  const stateKey=items.map(i=>i.settings.state).join('|')
  const fitted=(b:Box3[],p:Vector3[])=>pairCameraFrame(pairBounds(b,p),view.id,size.width,size.height,supportPoints(subjects,b,p))
  const frame=():BottleFrame=>({position:camera.position.clone(),target:controls.current!.target.clone(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current})
  const filmRoll=()=>{if(controls.current){camera.up.copy(bottleCameraUp(frame()));camera.lookAt(controls.current.target);camera.up.set(0,1,0)}}
  const applyCamera=(f:BottleFrame)=>{
    const orbit=controls.current!
    if(camera instanceof PerspectiveCamera){camera.fov=f.fov??28;camera.updateProjectionMatrix()}
    camera.position.copy(f.position);orbit.target.copy(f.target);roll.current=f.roll??0;filmRoll()
    const limits=bottleOrbitLimits(f);orbit.maxDistance=limits.maxDistance;orbit.maxPolarAngle=limits.maxPolarAngle
  }
  const planCamera=(goal:BottleFrame,now:number)=>{
    const previous=move.current,plan=studioCameraMove(frame(),goal,{previous:previous?.plan,elapsed:previous?now-previous.started:undefined})
    move.current=plan.duration?{plan,started:now}:null;controls.current!.enableDamping=!move.current
    if(!move.current)applyCamera(goal)
    return plan.duration
  }
  const place=()=>groups.current.forEach((g,i)=>g?.position.copy(positions.current[i]).multiplyScalar(PAIR_SCALE))
  const report=()=>{
    if(!controls.current||!boxes.current.length)return
    const projected:number[][]=[]
    filmRoll();camera.updateMatrixWorld()
    for(const point of supportPoints(subjects,boxes.current,positions.current))projected.push(point.multiplyScalar(PAIR_SCALE).project(camera).toArray())
    callbacks.current.onCamera({position:camera.position.toArray(),target:controls.current.target.toArray(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current,moving:!!move.current||!!motion.current,viewId:view.id,serial:view.serial,projected})
    const gap=(boxes.current[1].min.x+positions.current[1].x-boxes.current[0].max.x-positions.current[0].x)*1000
    callbacks.current.onLayout({items:boxes.current.map((b,i)=>({key:i,sizeMm:b.getSize(new Vector3()).multiplyScalar(1000).toArray(),min:b.min.clone().add(positions.current[i]).toArray(),max:b.max.clone().add(positions.current[i]).toArray()})),gapMm:gap,axis:[1,0,0]})
    callbacks.current.onMotion({id:sequence.current,active:!!motion.current,phase:motion.current?.phase??'rest',progress:motion.current?.progress??1,gapMm:gap,states:items.map(i=>i.settings.state)})
    gl.domElement.dataset.pairScale=String(PAIR_SCALE);gl.domElement.dataset.pairGapMm=String(gap);gl.domElement.dataset.pairPhase=motion.current?.phase??'rest'
  }
  useLayoutEffect(()=>{
    if(!controls.current)return
    const next=items.map(i=>i.settings.state),now=performance.now()/1000,finalBoxes=subjects.map((s,i)=>endpoint(s,next[i],i)),final=placePair(finalBoxes)
    if(!initialized.current||studioReducedMotion()){
      boxes.current=subjects.map((s,i)=>apply(s,next[i],i));positions.current=final.positions;states.current=next;motion.current=null;move.current=null;place();applyCamera(fitted(finalBoxes,final.positions));initialized.current=true;report();invalidate();return
    }
    if(next.join('|')!==states.current.join('|')&&!motion.current){
      const envelopes=subjects.map((s,i)=>envelope(s,states.current[i],next[i],i)),reserved=reservePair(positions.current,envelopes.map(e=>e.collision))
      const wide=pairBounds(envelopes.map(e=>e.frame),reserved).union(pairBounds(boxes.current,positions.current))
      const duration=Math.max(.6,planCamera(pairCameraFrame(wide,view.id,size.width,size.height),now))
      motion.current={id:++sequence.current,from:[...states.current],to:next,phase:'spacing',started:now,duration,positionsFrom:positions.current.map(p=>p.clone()),reserved,final:final.positions,wide,finalBounds:final.bounds,envelopes:envelopes.map(e=>e.collision),endo:subjects.map((s,i)=>s.endo?new EndoTimeline(states.current[i] as EndoState):null),bottleDurations:subjects.map((s,i)=>s.bottle&&states.current[i]!==next[i]?bottleMotionDuration(states.current[i] as BottleState,next[i] as BottleState):0),progress:0}
      report()
    }else if(!motion.current){planCamera(fitted(finalBoxes,final.positions),now);report()}
    else {applyCamera(pairCameraFrame(motion.current.wide,view.id,size.width,size.height));move.current=null}
    invalidate()
  // Palette and logo edits cannot restart either the pose or camera clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stateKey,view.serial,size.width,size.height,subjects])

  useFrame(()=>{
    const orbit=controls.current;if(!orbit)return
    const now=performance.now()/1000,m=motion.current,hadMove=!!move.current
    orbit.enabled=!m
    if(m){
      const elapsed=now-m.started
      if(m.phase==='spacing'){
        const t=smooth(elapsed/m.duration);positions.current.forEach((p,i)=>p.lerpVectors(m.positionsFrom[i],m.reserved[i],t))
        if(elapsed>=m.duration){m.phase='motion';m.started=now;m.endo.forEach((t,i)=>{if(t){t.lead=0;t.request(m.to[i] as EndoState,m.id,now,studioReducedMotion())}})}
      }else if(m.phase==='motion'){
        let complete=true,progress=1
        boxes.current=subjects.map((s,i)=>{
          if(m.endo[i]){const t=m.endo[i]!;t.sample(now);complete&&=!t.active;const span=Math.abs(endoIndex(m.to[i] as EndoState)-endoIndex(m.from[i] as EndoState));progress=Math.min(progress,span?Math.abs(t.coordinate-endoIndex(m.from[i] as EndoState))/span:1);return apply(s,m.to[i],i,m.from[i],1,t.coordinate)}
          const t=m.bottleDurations[i]?Math.min(1,elapsed/m.bottleDurations[i]):1;complete&&=t===1;progress=Math.min(progress,t);return apply(s,m.to[i],i,m.from[i],t)
        });m.progress=progress
        if(complete){m.phase='settling';m.started=now;m.positionsFrom=positions.current.map(p=>p.clone());m.duration=Math.max(.6,planCamera(fitted(boxes.current,m.final),now))}
      }else {
        const t=smooth(elapsed/m.duration);positions.current.forEach((p,i)=>p.lerpVectors(m.positionsFrom[i],m.final[i],t))
        if(elapsed>=m.duration){states.current=m.to;motion.current=null}
      }
      place();gl.shadowMap.needsUpdate=true
    }
    if(move.current){
      const t=studioReducedMotion()?1:Math.min(1,(now-move.current.started)/move.current.plan.duration)
      applyCamera(studioCameraFrame(move.current.plan,t));if(t===1){move.current=null;orbit.enableDamping=true}
    }else filmRoll()
    if(m||move.current)invalidate()
    if((m||move.current)&&now-lastReport.current>.10||m&&!motion.current||hadMove&&!move.current){lastReport.current=now;report()}
  },-.5)
  return <>
    {subjects.map((s,i)=><group key={i} ref={g=>{groups.current[i]=g}}><group scale={PAIR_SCALE}><Actor item={items[i]} subject={s} onSelect={onSelect}/></group></group>)}
    <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={.7} maxDistance={40} minPolarAngle={.08} maxPolarAngle={Math.PI/2-.01} rotateSpeed={.6} dampingFactor={.13} onStart={()=>{if(motion.current)return;move.current=null;controls.current!.enableDamping=true;callbacks.current.onInteract()}} onEnd={()=>{if(!motion.current&&!move.current)report()}}/>
  </>
}

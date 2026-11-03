import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BackSide, Mesh, MeshPhysicalMaterial, PerspectiveCamera, Vector2, DoubleSide, Texture } from 'three'
import { StudioStage } from './StudioStage'
import { bottleSoftShadows } from './bottleShadows'
import { configureSourceModel } from './sourceModel'
import type { StudioItem } from './SourceScene'
import { decorationTextures } from './sourceDecoration'
import { PILLOW } from './pillow'
import { createPillowSubject, PILLOW_SCALE, pillowCameraFrame, pillowCameraPlan, pillowCameraTransition, pillowFocusPoints } from './pillowViews'
import type { PillowCameraPlan, PillowSubject, PillowViewRequest } from './pillowViews'
import { bottleCameraUp, bottleOrbitLimits } from './bottleCameraMotion'
import type { BottleFrame } from './bottleCameraMotion'
import { studioReducedMotion } from './studioCameraMotion'

export interface PillowCameraSnapshot {position:number[];target:number[];fov:number;roll:number;moving:boolean;viewId:string;serial:number;projected:number[][];time:number}
interface Props {item?:StudioItem;view:PillowViewRequest;onReady:(save:(name:string)=>void,renderer:string)=>void;fallback:string;onCamera:(snapshot:PillowCameraSnapshot)=>void;onInteract:()=>void}

export function PillowDecoration({item}:{item:StudioItem}){
  const {scene,gl,invalidate}=useThree(),method=item.settings.decoration.technique
  const base=useMemo(()=>{
    let mesh:Mesh|undefined
    item.model.root.traverse(o=>{if(o instanceof Mesh&&o.userData.print_surface==='side')mesh=o})
    if(!mesh)throw Error('Missing pillow decoration surface')
    item.model.root.traverse(o=>{if(o instanceof Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.shadowSide=BackSide;for(const value of Object.values(m))if(value instanceof Texture)value.anisotropy=8}if(/CoverJoin|PanelSeam|Topstitch/.test(o.name))o.castShadow=false}})
    // Close-fitting skins use the stage's existing AO exclusion contract. The
    // cushion beneath supplies depth; two sub-mm layers would self-occlude.
    item.model.root.traverse(o=>{if(o.userData.pillow_part==='controls'||o.userData.pillow_attachment_cuff)o.traverse(child=>{if(child instanceof Mesh){child.castShadow=false;child.receiveShadow=false;child.userData.bottleShadowReceiver=true}})})
    return {mesh,geometry:mesh.geometry,material:mesh.material}
  },[item.model])
  const textures=useMemo(()=>decorationTextures(PILLOW.zones[0],item.settings,item.logo),[item.settings.enabled,method,item.settings.decoration.colors,item.logo])
  const geometry=useMemo(()=>{
    const g=base.geometry.clone(),p=g.attributes.position,n=g.attributes.normal,raise=method==='embroidery'?.00018:.000012
    for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)+n.getX(i)*raise,p.getY(i)+n.getY(i)*raise,p.getZ(i)+n.getZ(i)*raise)
    return g
  },[base,method])
  const material=useMemo(()=>{
    const thread=method==='embroidery',reflect=method==='reflective'
    return bottleSoftShadows(new MeshPhysicalMaterial({name:'PillowDecoration-'+method,map:textures.map,normalMap:thread?textures.normalMap:null,normalScale:new Vector2(.60,.60),transparent:true,alphaTest:.02,side:DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,roughness:thread?.80:reflect?.26:method==='transfer'?.55:.66,metalness:reflect?.72:0,sheen:thread?.35:0,sheenColor:'#a8b5c4',sheenRoughness:.8,clearcoat:reflect?.15:0,clearcoatRoughness:.35}))
  },[textures,method])
  useEffect(()=>()=>textures.dispose(),[textures]);useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material])
  useLayoutEffect(()=>{
    configureSourceModel(item.model,PILLOW,item.settings)
    base.mesh.geometry=geometry;base.mesh.material=material;base.mesh.visible=!!item.logo&&item.settings.enabled;base.mesh.castShadow=false;base.mesh.renderOrder=2
    scene.userData.bottleDecorationVersion=(scene.userData.bottleDecorationVersion??0)+1;gl.domElement.dataset.shadowFrames='0';invalidate()
    return()=>{base.mesh.geometry=base.geometry;base.mesh.material=base.material;base.mesh.visible=false}
  },[base,item.model,item.logo,item.settings.enabled,item.settings.color,geometry,material,scene,gl,invalidate])
  return <primitive object={item.model.root} dispose={null}/>
}

function PillowCamera({subject,view,onCamera,onInteract}:Pick<Props,'view'|'onCamera'|'onInteract'>&{subject:PillowSubject}){
  const {camera,size,invalidate}=useThree(),controls=useRef<ComponentRef<typeof OrbitControls>>(null)
  const initialized=useRef(false),roll=useRef(0),lastReport=useRef(0)
  const change=useRef<{start:BottleFrame;time:number;duration:number;plan:PillowCameraPlan}|null>(null)
  const goal=useMemo(()=>pillowCameraFrame(subject,view.id,size.width,size.height),[subject,view.id,size.width,size.height])
  const current=():BottleFrame=>({position:camera.position.clone(),target:controls.current!.target.clone(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current})
  const filmRoll=()=>{if(!controls.current)return;camera.up.copy(bottleCameraUp(current()));camera.lookAt(controls.current.target);camera.up.set(0,1,0)}
  const apply=(frame:BottleFrame)=>{
    const orbit=controls.current!
    if(camera instanceof PerspectiveCamera){camera.fov=frame.fov??28;camera.updateProjectionMatrix()}
    const limits=bottleOrbitLimits(frame);orbit.maxDistance=limits.maxDistance;orbit.maxPolarAngle=limits.maxPolarAngle
    camera.position.copy(frame.position);orbit.target.copy(frame.target);camera.up.set(0,1,0);roll.current=frame.roll??0;filmRoll()
  }
  const report=(moving:boolean)=>{
    if(!controls.current)return;filmRoll();camera.updateMatrixWorld()
    const projected=pillowFocusPoints(subject,view.id).map(p=>p.clone().multiplyScalar(PILLOW_SCALE).project(camera).toArray())
    onCamera({position:camera.position.toArray(),target:controls.current.target.toArray(),fov:camera instanceof PerspectiveCamera?camera.fov:28,roll:roll.current,moving,viewId:view.id,serial:view.serial,projected,time:performance.now()})
  }
  useLayoutEffect(()=>{
    if(!controls.current)return
    if(!initialized.current||studioReducedMotion()){apply(goal);initialized.current=true;change.current=null;controls.current.enableDamping=true;report(false)}
    else {
      const start=current(),now=performance.now()/1000,previous=change.current,plan=pillowCameraPlan(start,goal,subject,size.width,size.height,previous?.plan,previous?now-previous.time:undefined)
      change.current=plan.move.duration?{start,time:now,duration:plan.move.duration,plan}:null
      controls.current.enableDamping=!change.current;if(!change.current)apply(goal);report(!!change.current)
    }
    invalidate()
  // Logo and material edits intentionally keep the camera and its clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view.serial,size.width,size.height,subject])
  useFrame(()=>{
    const orbit=controls.current;if(!orbit)return
    if(change.current){
      const now=performance.now()/1000,t=studioReducedMotion()?1:Math.min(1,(now-change.current.time)/change.current.duration)
      apply(pillowCameraTransition(change.current.start,goal,subject,t,size.width,size.height,change.current.plan))
      if(t===1){change.current=null;orbit.enableDamping=true;report(false)}
      else {if(now-lastReport.current>.10){lastReport.current=now;report(true)}invalidate()}
    }else filmRoll()
  },-.5)
  const limits=bottleOrbitLimits(goal)
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={.4} maxDistance={limits.maxDistance} minPolarAngle={.08} maxPolarAngle={limits.maxPolarAngle} rotateSpeed={.65} dampingFactor={.13} onStart={()=>{change.current=null;controls.current!.enableDamping=true;onInteract()}} onEnd={()=>report(false)}/>
}

export function PillowAssembly({item,...props}:Omit<Props,'item'|'fallback'|'onReady'>&{item:StudioItem}){
  const subject=useMemo(()=>createPillowSubject(item.model.root),[item.model])
  return <><group scale={PILLOW_SCALE}><PillowDecoration item={item}/></group><PillowCamera subject={subject} {...props}/></>
}
export function PillowScene({item,...props}:Props){
  return <StudioStage ready={!!item} moving={false} shadowKey={'pillow:'+item?.model.root.uuid} onReady={props.onReady} fallback={props.fallback}>{item&&<PillowAssembly item={item} view={props.view} onCamera={props.onCamera} onInteract={props.onInteract}/>}</StudioStage>
}

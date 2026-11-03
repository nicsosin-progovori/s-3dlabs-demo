import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { BOTTLE } from './bottle'
import embeddedFinal from '../models/bottle/hq-v01.json'
import { BOTTLE_HQ } from './bottleHq'
import { BottleComposition } from './CompositionActors'
import { automaticBottleView } from './bottleViewSettings'
import { StudioStage } from './StudioStage'
import { loadSkinnedModel } from './skinLoader'
import { loadSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import type { SkinnedSourceModel } from './skinLoader'
import type { SkinRef } from '../shared/skinContract.mjs'
import { bottleSettings } from './bottleBranding'
import { loadDeliveredLogo } from './logoDelivery'
import type {LogoAsset} from './types'
import type {BottleDecoration} from '../shared/bottleBrandingContract.mjs'
import { validateRenderRequest } from '../shared/renderContract.mjs'
import type { CameraSnapshot, RenderRequest } from '../shared/renderContract.mjs'
import { DEFAULT_SCENE } from '../shared/sceneContract.mjs'
import type { SceneBundle, SceneRef } from '../shared/sceneContract.mjs'
import { loadScene } from './sceneLoader'
import { lookFromScene } from './studioScene'
import type {Composition} from '../shared/compositionContract.mjs'
import {compositionNeedsWideStage} from './bottleComposition'

interface CameraResult {image:string;camera:CameraSnapshot}
type Capture=()=>Promise<CameraResult>
interface RenderResult extends CameraResult {skin:SkinRef;scene:SceneRef;composition:Composition;decoration:BottleDecoration}
type Reference='original'|'embedded-final'
declare global {interface Window {__bottleRender:(request:RenderRequest,reference?:Reference)=>Promise<RenderResult>}}
const root=createRoot(document.getElementById('root')!)
let sequence=0,active=false
// The optional, fixed reference choices are for private visual QA only.
// POST /api/render never forwards a source choice or a client-provided URL.
window.__bottleRender=async(input,reference)=>{
  if(active)throw new Error('Render worker is busy')
  if(reference!==undefined&&!['original','embedded-final'].includes(reference))throw new Error('Unknown QA reference')
  const request=validateRenderRequest(input)
  active=true
  try{return await new Promise<RenderResult>((resolve,reject)=>root.render(<RenderBottle key={++sequence} request={request} reference={reference} resolve={resolve} reject={reject}/>))}
  finally{active=false}
}
function RenderBottle({request,reference,resolve,reject}:{request:RenderRequest;reference?:Reference;resolve:(result:RenderResult)=>void;reject:(error:Error)=>void}){
  const [model,setModel]=useState<SourceModel|null>(null),capture=useRef<Capture|null>(null)
  const [scene,setScene]=useState<SceneBundle|null>(null)
  const [logo,setLogo]=useState<LogoAsset|null>(null),[logoReady,setLogoReady]=useState(false)
  const look=useMemo(()=>scene?lookFromScene(scene):null,[scene])
  useEffect(()=>{
    let cancelled=false,owned:SourceModel|undefined
    const controller=new AbortController()
    const product=reference==='original'?BOTTLE:{...BOTTLE,assetUrl:import.meta.env.BASE_URL+'models/bottle/bottle-hq-v01.glb?v='+embeddedFinal.glbSha256.slice(0,12)}
    const pending=reference?loadSourceModel(product,{signal:controller.signal}):loadSkinnedModel(BOTTLE_HQ,'final',request.skin,{signal:controller.signal})
    void pending.then(asset=>{if(cancelled){asset.dispose();return}owned=asset;setModel(asset)}).catch(error=>{if(!cancelled)reject(error)})
    void loadScene(request.scene??DEFAULT_SCENE,controller.signal).then(scene=>{if(!cancelled)setScene(scene)}).catch(error=>{if(!cancelled)reject(error)})
    void loadDeliveredLogo(request.decoration.logo,controller.signal).then(logo=>{if(!cancelled){setLogo(logo);setLogoReady(true)}}).catch(error=>{if(!cancelled)reject(error)})
    return()=>{cancelled=true;controller.abort();owned?.dispose()}
  },[reject,request.skin,request.scene,reference])
  const item=useMemo(()=>model&&logoReady?{key:0,model,settings:bottleSettings(request.state,BOTTLE.colors.find(c=>'bottle-'+c.id===request.skin.id)!.id,request.decoration),logo}:undefined,[model,logoReady,request.state,request.skin,request.decoration,logo])
  const ignore=useCallback(()=>{},[])
  const onReady=useCallback(async()=>{
    try{if(!capture.current||!model||!scene||!logoReady)throw new Error('Render camera/scene/logo is not ready');const skin=reference?request.skin:(model as SkinnedSourceModel).appearance.ref;resolve({...await capture.current(),skin:{...skin},scene:{...scene.ref},composition:request.composition,decoration:request.decoration})}catch(error){reject(error instanceof Error?error:new Error(String(error)))}
  },[resolve,reject,model,scene,logoReady,request,reference])
  return look&&<StudioStage imageRender composition={compositionNeedsWideStage(request.composition)} look={look} ready={!!item} moving={false} shadowKey={`server:${request.state}:${look.id}`} onReady={onReady} fallback="WebGL unavailable" pixelRatio={1}>
    {item&&<BottleComposition composition={request.composition} item={item} view={automaticBottleView()} motion={null} cameraEnabled={false} onLayout={ignore} onCamera={ignore} onMotion={ignore} onInteract={ignore}/>}
    <RenderCamera request={request} capture={capture} onError={reject}/>
  </StudioStage>
}
function RenderCamera({request,capture,onError}:{request:RenderRequest;capture:React.MutableRefObject<Capture|null>;onError:(error:Error)=>void}){
  const {camera,gl,invalidate}=useThree()
  useLayoutEffect(()=>{
    if(!(camera instanceof PerspectiveCamera))throw new Error('Perspective camera required')
    const lost=()=>onError(new Error('Render GPU context was lost'))
    gl.domElement.addEventListener('webglcontextlost',lost,{once:true})
    if(gl.getContext().isContextLost())lost()
    const snapshot=request.camera
    camera.position.fromArray(snapshot.position);camera.quaternion.fromArray(snapshot.quaternion)
    camera.fov=snapshot.fov;camera.aspect=snapshot.aspect;camera.near=snapshot.near;camera.far=snapshot.far;camera.zoom=snapshot.zoom
    camera.projectionMatrix.fromArray(snapshot.projectionMatrix)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld()
    capture.current=async()=>{
      const context=gl.getContext(),started=performance.now()
      if(context.isContextLost())throw new Error('Render GPU context was lost')
      if(!(context instanceof WebGL2RenderingContext))throw new Error('WebGL 2 is required for render completion')
      // CPU submission is not GPU completion. Keep the event loop available so
      // a software GPU crash can reject the job before PNG readback succeeds.
      const fence=context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE,0)
      if(!fence)throw new Error('Render GPU fence could not be created')
      context.flush()
      try{
        for(;;){
          if(context.isContextLost())throw new Error('Render GPU context was lost')
          const status=context.clientWaitSync(fence,0,0)
          if(status===context.ALREADY_SIGNALED||status===context.CONDITION_SATISFIED)break
          if(status===context.WAIT_FAILED)throw new Error('Render GPU completion failed')
          if(performance.now()-started>85000)throw new Error('Render GPU completion timed out')
          await new Promise(resolve=>setTimeout(resolve,8))
        }
      }finally{context.deleteSync(fence)}
      const image=gl.domElement.toDataURL('image/png')
      // Chromium may deliver contextlost after a readback has returned black.
      await new Promise(resolve=>setTimeout(resolve,0))
      if(context.isContextLost())throw new Error('Render GPU context was lost')
      return {image,camera:{...snapshot,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,projectionMatrix:camera.projectionMatrix.toArray()}}
    }
    invalidate()
    return()=>{capture.current=null;gl.domElement.removeEventListener('webglcontextlost',lost)}
  },[request,camera,gl,invalidate,capture,onError])
  return null
}

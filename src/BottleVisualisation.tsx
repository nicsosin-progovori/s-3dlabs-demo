import { Component, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, Ref } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, PerspectiveCamera, Texture, Vector3 } from 'three'
import { BOTTLE } from './bottle'
import { BOTTLE_HQ } from './bottleHq'
import { BottleComposition } from './CompositionActors'
import type { BottleMotionSnapshot } from './BottleScene'
import type { BottleState, CameraView } from './bottleViews'
import { bottleCameraRoll } from './bottleCameraMotion'
import { createBottleRig } from './bottleMotion'
import type { BottleMotionRequest } from './bottleMotion'
import { configureSourceModel } from './sourceModel'
import type { SourceModel } from './sourceModel'
import { initialSettings } from './sourceCatalog'
import { sampleLogo } from './logo'
import type {LogoAsset} from './types'
import {bottleSettings} from './bottleBranding'
import {DEFAULT_DECORATION,normaliseDecoration,patchDecoration,decorationKey} from '../shared/bottleBrandingContract.mjs'
import type {BottleDecoration,DecorationPatch,LogoRef} from '../shared/bottleBrandingContract.mjs'
import { StudioStage } from './StudioStage'
import { validateCamera } from '../shared/renderContract.mjs'
import type { CameraInput, CameraSnapshot } from '../shared/renderContract.mjs'
import { BOTTLE_LOW, BOTTLE_BACKGROUND_DOWNLOAD, idleTurn, nextPaint } from './bottleLod'
import { bottleAppearanceUpgrade } from './bottleLodAppearance'
import type { BottleAppearanceUpgrade } from './bottleLodAppearance'
import { studioReducedMotion } from './studioCameraMotion'
import { loadSkinnedModel, loadSkin } from './skinLoader'
import type { SkinnedSourceModel, SkinBundle } from './skinLoader'
import { DEFAULT_SKIN, sameSkin, normaliseSkin } from '../shared/skinContract.mjs'
import type { SkinRef } from '../shared/skinContract.mjs'
import type { CameraViewsStore } from './cameraViews'
import { automaticBottleView, cameraRequestFor, cameraViewsFor, cameraStateFor } from './bottleViewSettings'
import type { BottleViewCamera } from './bottleViewSettings'
import { sameScene } from '../shared/sceneContract.mjs'
import type { SceneBundle, SceneRef, SceneSelection, SceneProfile } from '../shared/sceneContract.mjs'
import { loadScene } from './sceneLoader'
import { lookFromScene } from './studioScene'
import { DEFAULT_COMPOSITION,normaliseComposition,compositionKey } from '../shared/compositionContract.mjs'
import type { Composition,CompositionBounds } from '../shared/compositionContract.mjs'
import { bottleCompositionMetrics,bottleViewBounds,compositionNeedsWideStage } from './bottleComposition'
import { bottleFrame } from './bottleCameraMotion'

export type { BottleViewCamera } from './bottleViewSettings'
export interface ViewerStatus {ready:boolean;state:BottleState;view:string|null;moving:boolean;error:string|null;errorKind?:'scene'|'model'|'webgl'|null;skin:SkinRef;decoration:BottleDecoration;logo:LogoAsset|null}
export interface BottleViewerHandle {
  setDecoration:(patch:DecorationPatch)=>Promise<void>
  getDecoration:()=>BottleDecoration
  setLogo:(asset:LogoAsset|null,ref:LogoRef)=>Promise<void>
  setComposition:(composition:Composition)=>Promise<void>
  getComposition:()=>Composition
  getCompositionBounds:()=>CompositionBounds
  setScene:(scene:SceneSelection)=>Promise<void>
  cancelScene:()=>void
  getScene:()=>SceneRef
  getSceneProfile:()=>SceneProfile|null
  setState:(state:BottleState)=>Promise<void>
  setCamera:(camera:CameraInput)=>Promise<void>
  getCamera:()=>CameraSnapshot
  getViews:()=>BottleViewCamera[]
  getState:()=>BottleState
  setSkin:(skin:SkinRef)=>Promise<void>
  cancelSkin:()=>void
  getSkin:()=>SkinRef
  imageSize:()=>{width:number;height:number}
}
interface Bridge {camera:()=>CameraSnapshot;size:()=>{width:number;height:number};visible:()=>boolean;shadowFrames:()=>number;prepare:(low:SourceModel,high:SourceModel,signal:AbortSignal)=>Promise<BottleAppearanceUpgrade>;prepareSkin:(model:SkinnedSourceModel,bundle:SkinBundle,signal:AbortSignal)=>Promise<()=>void>;refresh:()=>void}

class Boundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(){this.props.onError()}
  render(){return this.state.failed?null:this.props.children}
}

/** No HTML controls or download/canvas capture API belongs to this component. */
export function BottleVisualisation({ref,onStatus,cameraViews,onScene,onSceneError,label='Isolierflasche in 3D',fallback='WebGL ist nicht verfügbar'}:{ref:Ref<BottleViewerHandle>;onStatus:(status:ViewerStatus)=>void;cameraViews:CameraViewsStore;onScene:(scene:SceneBundle)=>void;onSceneError:(error:Error)=>void;label?:string;fallback?:string}) {
  const {catalog}=useSyncExternalStore(cameraViews.subscribe,cameraViews.getSnapshot)
  const [composition,setComposition]=useState<Composition>(DEFAULT_COMPOSITION),compositionRef=useRef<Composition>(DEFAULT_COMPOSITION)
  const compositionSignature=useMemo(()=>compositionKey(composition),[composition])
  const [model,setModel]=useState<SourceModel|null>(null),[state,setState]=useState<BottleState>('closed')
  const [highModel,setHighModel]=useState<SourceModel|null>(null)
  const [appearance,setAppearance]=useState<BottleAppearanceUpgrade|null>(null)
  const [scene,setScene]=useState<SceneBundle|null>(null),[sceneStatus,setSceneStatus]=useState<'loading'|'waiting-idle'|'preparing'|'ready'|'failed'>('loading')
  const sceneRef=useRef<SceneBundle|null>(null),scenePrepared=useRef<string|null>(null),sceneAbort=useRef<AbortController|null>(null),lifeAbort=useRef<AbortController|null>(null)
  const look=useMemo(()=>scene?lookFromScene(scene):null,[scene])
  const [skin,setSkin]=useState<SkinRef>(()=>({...DEFAULT_SKIN}))
  const [skinStatus,setSkinStatus]=useState<'ready'|'loading'|'waiting-idle'|'failed'>('ready')
  const skinRef=useRef<SkinRef>({...DEFAULT_SKIN}),skinGeneration=useRef(0),skinAbort=useRef<AbortController|null>(null),lifeSignal=useRef<AbortSignal|null>(null),blendActive=useRef(false)
  const assets=useRef<{low?:SkinnedSourceModel;high?:SkinnedSourceModel}>({})
  const [qualityStatus,setQualityStatus]=useState<'loading-low'|'low'|'loading-high'|'preparing-high'|'waiting-idle'|'blending-high'|'high'|'high-failed'>('loading-low')
  const [qualityTimes,setQualityTimes]=useState<{lowVisibleAt?:number;highRequestAt?:number;highPromotedAt?:number;highReadyAt?:number}>({})
  const [view,setView]=useState<CameraView>(()=>automaticBottleView())
  const [motion,setMotion]=useState<BottleMotionRequest|null>(null),[moving,setMoving]=useState(false)
  const [errorKind,setErrorKind]=useState<'scene'|'model'|'webgl'|null>(null)
  const [ready,setReady]=useState(false),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null)
  const bridge=useRef<Bridge|null>(null),alive=useRef(true),stateRef=useRef(state),request=useRef(0),motionId=useRef(0)
  const lowVisible=useRef(false),interaction=useRef(false),commandBusy=useRef(false)
  const cameraTouched=useRef(false)
  const cameraReport=useRef<{request?:number;moving?:boolean}>({}),motionReport=useRef<BottleMotionSnapshot|null>(null)
  const [logo,setLogo]=useState<LogoAsset|null>(()=>sampleLogo(true))
  const [decoration,setDecoration]=useState<BottleDecoration>(()=>normaliseDecoration(DEFAULT_DECORATION)),decorationRef=useRef(decoration)
  const item=useMemo(()=>model?{key:0,model,settings:bottleSettings(state,skin.id.slice('bottle-'.length),decoration),logo}:undefined,[model,state,skin,decoration,logo])
  const rig=useMemo(()=>model?createBottleRig(model.root):null,[model])
  useEffect(()=>{
    const controller=new AbortController()
    void loadScene(null,controller.signal).then(bundle=>{
      if(controller.signal.aborted)return
      sceneRef.current=bundle;setScene(bundle);setSceneStatus('preparing');onScene(bundle)
    }).catch(cause=>{
      if(controller.signal.aborted)return
      const error=cause instanceof Error?cause:new Error(String(cause))
      setSceneStatus('failed');setErrorKind('scene');setError('Die Studio-Szene konnte nicht geladen werden. Bitte die Seite neu laden.');onSceneError(error);lifeAbort.current?.abort()
    })
    return()=>controller.abort()
  },[onScene,onSceneError])
  useEffect(()=>{
    if(!catalog)return
    // Only an unseen first frame may adopt the initial catalogue default.
    // Late delivery and refreshes must never undo a customer's camera.
    if(!lowVisible.current&&!cameraTouched.current){
      const next=cameraRequestFor(catalog,stateRef.current,++request.current,undefined,decorationRef.current.surface)
      setView(next);setSelected(cameraStateFor(catalog,stateRef.current,decorationRef.current.surface)?.defaultView??null)
    }else if(rig&&bridge.current){
      const actual=validateCamera(bridge.current.camera())
      const match=cameraViewsFor(catalog,rig,stateRef.current,bridge.current.size(),compositionRef.current,decorationRef.current.surface).find(entry=>camerasMatch(entry.camera,actual))
      setSelected(match?.id??null)
    }
  },[catalog,rig])
  useEffect(()=>{
    alive.current=true
    let cancelled=false,low:SkinnedSourceModel|undefined,high:SkinnedSourceModel|undefined
    const controller=new AbortController(),signal=controller.signal
    lifeAbort.current=controller
    lifeSignal.current=signal
    void (async()=>{
      try{
        low=await loadSkinnedModel(BOTTLE_LOW,'low',skinRef.current,{signal,priority:'high'})
        if(cancelled){low.dispose();return}
        assets.current.low=low
        setModel(low);setQualityStatus('low')
        while(!lowVisible.current){await nextPaint(signal)}
        while(!bridge.current?.visible()){await nextPaint(signal)}
        setQualityTimes(times=>({...times,lowVisibleAt:performance.now()}))
        await nextPaint(signal);await idleTurn(signal)
        signal.throwIfAborted()
        setQualityStatus('loading-high');setQualityTimes(times=>({...times,highRequestAt:performance.now()}))
        high=await loadSkinnedModel(BOTTLE_HQ,'final',skinRef.current,{...BOTTLE_BACKGROUND_DOWNLOAD,signal})
        if(cancelled){high.dispose();return}
        assets.current.high=high
        for(;;){
          setQualityStatus('preparing-high')
          if(!sameSkin(high.appearance.ref,skinRef.current)){
            const ref={...skinRef.current},bundle=await loadSkin(ref,'final',signal,'low')
            if(!sameSkin(ref,skinRef.current)){bundle.dispose();continue}
            high.appearance.apply(bundle)
          }
          const generation=skinGeneration.current,upgrade=await bridge.current!.prepare(low,high,signal)
          setQualityStatus('waiting-idle')
          while(commandBusy.current||interaction.current||motionReport.current?.active||cameraReport.current.moving){await nextPaint(signal)}
          signal.throwIfAborted()
          if(generation!==skinGeneration.current){upgrade.restore();continue}
          blendActive.current=true
          setHighModel(high);setAppearance(upgrade);setQualityStatus('blending-high');setQualityTimes(times=>({...times,highPromotedAt:performance.now()}))
          break
        }
      }catch{
        if(cancelled||signal.aborted)return
        if(low){assets.current.high=undefined;high?.dispose();high=undefined;setQualityStatus('high-failed')}
        else {setErrorKind('model');setError('Die Flasche konnte nicht geladen werden. Bitte die Seite neu laden.')}
      }
    })()
    return()=>{cancelled=true;alive.current=false;controller.abort();skinAbort.current?.abort();sceneAbort.current?.abort();assets.current={};low?.dispose();high?.dispose()}
  },[])
  useEffect(()=>{
    if(ready||error)return
    const timer=setTimeout(()=>{setErrorKind('webgl');setError('Die 3D-Ansicht ist nicht verfügbar. Bitte WebGL prüfen und die Seite neu laden.')},45_000)
    return()=>clearTimeout(timer)
  },[ready,error])
  useEffect(()=>onStatus({ready,state,view:selected,moving,error,errorKind,skin,decoration,logo}),[ready,state,selected,moving,error,errorKind,skin,decoration,logo,onStatus])
  const waitFor=async(test:()=>boolean)=>{
    const deadline=performance.now()+45_000
    while(!test()){
      if(!alive.current)throw new Error('Viewer was closed')
      if(performance.now()>deadline)throw new Error('Viewer transition timed out')
      await new Promise(resolve=>setTimeout(resolve,25))
    }
  }
  const views=():BottleViewCamera[]=>{
    if(!rig||!bridge.current)return []
    return cameraViewsFor(cameraViews.getSnapshot().catalog,rig,stateRef.current,bridge.current.size(),compositionRef.current,decorationRef.current.surface)
  }
  const commitBranding=async(next:BottleDecoration,asset:LogoAsset|null)=>{
    if(decorationKey(next)===decorationKey(decorationRef.current)&&asset===logo)return
    const signal=lifeSignal.current!,surfaceChanged=next.surface!==decorationRef.current.surface
    commandBusy.current=true
    try{
      while(blendActive.current||interaction.current||motionReport.current?.active||cameraReport.current.moving){await nextPaint(signal)}
      signal.throwIfAborted()
      decorationRef.current=next;skinGeneration.current++;setDecoration(next);setLogo(asset)
      let serial:number|undefined
      if(surfaceChanged){
        const catalog=cameraViews.getSnapshot().catalog,data=cameraStateFor(catalog,stateRef.current,next.surface)
        const id=data?.views.find(view=>view.id==='branding')?.id??data?.defaultView??undefined
        serial=++request.current;cameraTouched.current=true;setSelected(id??null)
        setView(cameraRequestFor(catalog,stateRef.current,serial,id,next.surface))
      }
      bridge.current!.refresh()
      await nextPaint(signal);await nextPaint(signal)
      if(serial!==undefined)await waitFor(()=>cameraReport.current.request===serial&&!cameraReport.current.moving)
      await waitFor(()=>bridge.current!.shadowFrames()>=(sceneRef.current?.profile.settings.shadow.frames??48))
    }finally{commandBusy.current=false}
  }
  useImperativeHandle(ref,()=>({
    getDecoration:()=>normaliseDecoration(decorationRef.current),
    setDecoration:patch=>commitBranding(patchDecoration(decorationRef.current,patch),logo),
    setLogo:(asset,ref)=>commitBranding(normaliseDecoration({...decorationRef.current,logo:ref}),asset),
    getComposition:()=>structuredClone(compositionRef.current),
    getCompositionBounds(){if(!rig)throw Error('Composition is not ready');return bottleCompositionMetrics(rig,stateRef.current,compositionRef.current)},
    async setComposition(input){
      const next=normaliseComposition(input)
      if(compositionKey(next)===compositionKey(compositionRef.current))return
      if(!rig||!bridge.current)throw Error('Composition is not ready')
      const data=cameraViews.getSnapshot().catalog,serial=++request.current,nextView=cameraRequestFor(data,stateRef.current,serial,undefined,decorationRef.current.surface),size=bridge.current.size()
      const bounds=bottleViewBounds(rig,stateRef.current,nextView,next),frame=bottleFrame(bounds,nextView.azimuth,nextView.elevation,size.width,size.height,{...nextView,zoom:nextView.projection?.zoom})
      validateCamera({position:frame.position.toArray(),target:frame.target.toArray(),fov:frame.fov,roll:frame.roll,...nextView.projection})
      const signal=lifeSignal.current!
      commandBusy.current=true
      try{
        while(blendActive.current||interaction.current||motionReport.current?.active||cameraReport.current.moving){await nextPaint(signal)}
        signal.throwIfAborted()
        compositionRef.current=next;skinGeneration.current++;cameraTouched.current=true
        setComposition(next);setMotion(null);setSelected(cameraStateFor(data,stateRef.current,decorationRef.current.surface)?.defaultView??null);setView(nextView)
        await waitFor(()=>cameraReport.current.request===serial&&!cameraReport.current.moving)
        await waitFor(()=>bridge.current!.shadowFrames()>=(sceneRef.current?.profile.settings.shadow.frames??48))
      }finally{commandBusy.current=false}
    },
    cancelScene(){sceneAbort.current?.abort(new DOMException('Scene request superseded','AbortError'))},
    getScene(){if(!sceneRef.current)throw Error('Scene is not ready');return {...sceneRef.current.ref}},
    getSceneProfile:()=>structuredClone(sceneRef.current?.profile??null),
    async setScene(selection){
      const controller=new AbortController();sceneAbort.current?.abort();sceneAbort.current=controller
      const signal=lifeSignal.current?AbortSignal.any([controller.signal,lifeSignal.current]):controller.signal
      commandBusy.current=true;setSceneStatus('loading')
      try{
        const bundle=await loadScene(selection,signal)
        if(sceneRef.current&&sameScene(bundle.ref,sceneRef.current.ref)){setSceneStatus('ready');return}
        setSceneStatus('waiting-idle')
        while(blendActive.current||interaction.current||motionReport.current?.active||cameraReport.current.moving){await nextPaint(signal)}
        signal.throwIfAborted()
        // Once committed, complete this preparation before a later queued scene.
        // A cancelled data fetch never changes the current studio.
        sceneRef.current=bundle;skinGeneration.current++;setScene(bundle);setSceneStatus('preparing');onScene(bundle)
        await waitFor(()=>scenePrepared.current===bundle.ref.sha256)
        await nextPaint(lifeSignal.current??signal)
      }catch(error){if(alive.current)setSceneStatus(signal.aborted?'ready':'failed');throw error}
      finally{if(sceneAbort.current===controller)sceneAbort.current=null;commandBusy.current=false}
    },
    cancelSkin(){skinAbort.current?.abort(new DOMException('Skin request superseded','AbortError'))},
    getSkin:()=>({...skinRef.current}),
    async setSkin(input){
      const next=normaliseSkin(input)
      if(sameSkin(next,skinRef.current))return
      const controller=new AbortController()
      skinAbort.current?.abort();skinAbort.current=controller
      const signal=lifeSignal.current?AbortSignal.any([lifeSignal.current,controller.signal]):controller.signal
      const prepared=new Map<SkinnedSourceModel,SkinBundle>()
      const previews:Array<()=>void>=[]
      commandBusy.current=true;setSkinStatus('loading')
      try{
        const prepare=async(model:SkinnedSourceModel,quality:'low'|'final')=>{
          const bundle=await loadSkin(next,quality,signal)
          prepared.set(model,bundle);previews.push(await bridge.current!.prepareSkin(model,bundle,signal))
        }
        if(!assets.current.low)throw new Error('Viewer is not ready')
        await prepare(assets.current.low,'low')
        for(;;){
          const high=assets.current.high
          if(high&&!prepared.has(high))await prepare(high,'final')
          setSkinStatus('waiting-idle')
          while(blendActive.current||interaction.current||motionReport.current?.active||cameraReport.current.moving){await nextPaint(signal)}
          if(assets.current.high&&!prepared.has(assets.current.high))continue
          break
        }
        signal.throwIfAborted()
        for(const [model,bundle]of prepared){
          if(model!==assets.current.low&&model!==assets.current.high){bundle.dispose();continue}
          model.appearance.apply(bundle)
        }
        prepared.clear()
        skinRef.current=next;skinGeneration.current++;setSkin(next);setSkinStatus('ready');bridge.current!.refresh()
        // Keep precompiled material variants alive until live materials have
        // rendered. Superseding an already committed selection cannot undo it.
        await nextPaint(lifeSignal.current??signal);await nextPaint(lifeSignal.current??signal)
      }catch(error){
        if(alive.current)setSkinStatus(signal.aborted?'ready':'failed')
        throw error
      }finally{
        prepared.forEach(bundle=>bundle.dispose())
        previews.forEach(dispose=>dispose())
        if(skinAbort.current===controller)skinAbort.current=null
        commandBusy.current=false
      }
    },
    async setState(next){
      if(next===stateRef.current)return
      commandBusy.current=true
      try{
        const id=++motionId.current,serial=++request.current,from=stateRef.current
        const currentCatalog=cameraViews.getSnapshot().catalog
        cameraTouched.current=true;stateRef.current=next;setSelected(cameraStateFor(currentCatalog,next,decorationRef.current.surface)?.defaultView??null);setMoving(true)
        setMotion({id,from,to:next,startedAt:performance.now()});setState(next);setView(cameraRequestFor(currentCatalog,next,serial,undefined,decorationRef.current.surface))
        await waitFor(()=>motionReport.current?.id===id&&!motionReport.current.active&&cameraReport.current.request===serial&&!cameraReport.current.moving)
      }finally{commandBusy.current=false}
    },
    async setCamera(input){
      commandBusy.current=true
      try{
        const camera=validateCamera(input),serial=++request.current
        cameraTouched.current=true
        const matched=views().find(v=>camerasMatch(v.camera,camera))
        setSelected(matched?.id??null)
        setView({...automaticBottleView(serial),id:matched?.id??'free',absolute:camera})
        await waitFor(()=>cameraReport.current.request===serial&&!cameraReport.current.moving)
      }finally{commandBusy.current=false}
    },
    getCamera(){if(!bridge.current)throw new Error('Viewer is not ready');return bridge.current.camera()},
    getViews:views,
    getState:()=>stateRef.current,
    imageSize(){
      if(!bridge.current)throw new Error('Viewer is not ready')
      const {width,height}=bridge.current.size(),scale=Math.min(2,1600/Math.max(width,height))
      return {width:Math.max(64,Math.round(width*scale)),height:Math.max(64,Math.round(height*scale))}
    },
  }))
  const onMotion=useCallback((next:BottleMotionSnapshot)=>{motionReport.current=next;setMoving(next.active)},[])
  const onCamera=useCallback((next:object)=>{cameraReport.current=next},[])
  const onInteract=useCallback(()=>{cameraTouched.current=true;setSelected(null)},[])
  const onInteraction=useCallback((active:boolean)=>{interaction.current=active},[])
  const onUpgraded=useCallback(()=>{blendActive.current=false;setAppearance(null);setQualityStatus('high');setQualityTimes(times=>({...times,highReadyAt:performance.now()}))},[])
  const noLayout=useCallback(()=>{},[]),onReady=useCallback(()=>{scenePrepared.current=scene?.ref.sha256??null;setSceneStatus('ready');lowVisible.current=true;setReady(true)},[scene])
  return <div className="bottle-visualisation" data-testid="bottle-visualisation" data-composition={composition.id} data-composition-elements={composition.elements.filter(e=>e.visible).length} data-scene={scene?.ref.id} data-scene-revision={scene?.ref.revision} data-scene-sha256={scene?.ref.sha256} data-scene-status={sceneStatus} data-skin={skin.id} data-skin-revision={skin.revision} data-skin-status={skinStatus} data-state={state} data-ready={ready} data-moving={moving} data-quality={qualityStatus==='high'?'high':model?'low':'loading'} data-quality-status={qualityStatus} data-low-visible-at={qualityTimes.lowVisibleAt} data-high-request-at={qualityTimes.highRequestAt} data-high-promoted-at={qualityTimes.highPromotedAt} data-high-ready-at={qualityTimes.highReadyAt} data-decoration-surface={decoration.surface} data-decoration-technique={decoration.technique} data-decoration-enabled={decoration.enabled} data-logo-kind={decoration.logo.kind} aria-label={label} role="img">
    <Boundary onError={()=>{setErrorKind('webgl');setError('Die 3D-Ansicht ist nicht verfügbar. Bitte WebGL prüfen und die Seite neu laden.')}}>
      {look&&<StudioStage composition={compositionNeedsWideStage(composition)} look={look} ready={!!item} moving={moving} shadowKey={`${model?.root.uuid}:${state}:${motion?.id??0}:${look.id}:${compositionSignature}`} onReady={onReady} fallback={fallback}>
        {item&&<BottleComposition composition={composition} item={item} renderModel={highModel??undefined} view={view} motion={motion} onLayout={noLayout} onCamera={onCamera} onMotion={onMotion} onInteract={onInteract} onInteraction={onInteraction}/>}
        <CameraBridge bridge={bridge}/>
        {appearance&&<AppearanceBlend upgrade={appearance} onComplete={onUpgraded}/>}
      </StudioStage>}
    </Boundary>
  </div>
}

function camerasMatch(a:CameraInput,b:CameraInput){
  const values=(value:CameraInput)=>{const c=validateCamera(value);return [...c.position,...c.target,c.fov,c.roll,c.near,c.far,c.zoom]}
  const left=values(a),right=values(b)
  return left.every((value,index)=>Math.abs(value-right[index])<1e-6)
}

function CameraBridge({bridge}:{bridge:React.MutableRefObject<Bridge|null>}){
  const get=useThree(s=>s.get)
  useEffect(()=>{
    bridge.current={
      camera(){
        const {camera,controls}=get()
        if(!(camera instanceof PerspectiveCamera)||!controls)throw new Error('Camera is not ready')
        const target=(controls as unknown as {target:Vector3}).target
        camera.updateMatrixWorld()
        const roll=bottleCameraRoll(camera.position,target,new Vector3(0,1,0).applyQuaternion(camera.quaternion))
        return {position:camera.position.toArray(),target:target.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,roll,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,projectionMatrix:camera.projectionMatrix.toArray()}
      },
      size(){const {size}=get();return {width:size.width,height:size.height}},
      visible(){const {gl}=get();return gl.domElement.dataset.studioVisible==='true'&&Number(getComputedStyle(gl.domElement).opacity)>.999},
      shadowFrames(){return Number(get().gl.domElement.dataset.shadowFrames??0)},
      refresh(){const {scene,gl,invalidate}=get();scene.userData.bottleDecorationVersion=(scene.userData.bottleDecorationVersion??0)+1;gl.shadowMap.needsUpdate=true;invalidate()},
      async prepareSkin(model,bundle,signal){
        const {gl,camera,scene}=get(),unique=new Set<Texture>()
        for(const material of bundle.materials.values())for(const value of Object.values(material))if(value instanceof Texture)unique.add(value)
        for(const texture of unique){await idleTurn(signal);gl.initTexture(texture)}
        const preview=model.appearance.preview(bundle)
        try{await idleTurn(signal);await gl.compileAsync(preview.root,camera,scene);signal.throwIfAborted();return preview.dispose}
        catch(error){preview.dispose();throw error}
      },
      async prepare(low,model,signal){
        const {gl,camera,scene}=get(),textures=new Set<Texture>()
        configureSourceModel(model,BOTTLE,initialSettings('bottle'))
        model.root.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])for(const value of Object.values(material))if(value instanceof Texture)textures.add(value)})
        for(const texture of textures){await idleTurn(signal);gl.initTexture(texture)}
        await idleTurn(signal)
        await gl.compileAsync(model.root,camera,scene)
        signal.throwIfAborted()
        const upgrade=bottleAppearanceUpgrade(low,model)
        try{await idleTurn(signal);await gl.compileAsync(model.root,camera,scene);signal.throwIfAborted();return upgrade}
        catch(error){upgrade.restore();throw error}
      },
    }
    return()=>{bridge.current=null}
  },[get,bridge])
  return null
}

function AppearanceBlend({upgrade,onComplete}:{upgrade:BottleAppearanceUpgrade;onComplete:()=>void}){
  const {invalidate,gl}=useThree(),started=useRef(performance.now()),done=useRef(false)
  const duration=useMemo(()=>studioReducedMotion()?0:320,[])
  useEffect(()=>{invalidate();return()=>upgrade.restore()},[upgrade,invalidate])
  useFrame(()=>{
    if(done.current)return
    const progress=duration?Math.min(1,(performance.now()-started.current)/duration):1
    upgrade.mix.value=progress*progress*(3-2*progress)
    gl.domElement.dataset.lodBlend=String(upgrade.mix.value)
    invalidate()
    if(progress===1){done.current=true;upgrade.restore();onComplete()}
  },-1)
  return null
}

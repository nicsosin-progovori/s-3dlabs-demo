import { normaliseState, validateCamera, RENDER_VERSION } from '../shared/renderContract.mjs'
import type { CameraInput, CameraSnapshot } from '../shared/renderContract.mjs'
import type { BottleViewerHandle, BottleViewCamera } from './BottleVisualisation'
import type { BottleState } from './bottleViews'
import { normaliseSkin, availableSkins } from '../shared/skinContract.mjs'
import type { SkinRef } from '../shared/skinContract.mjs'
import type { CameraViewsStore } from './cameraViews'
import type { CameraViewCatalog } from '../shared/cameraViewsContract.mjs'
import { normaliseSceneSelection } from '../shared/sceneContract.mjs'
import type { SceneSelection, SceneRef, SceneProfile } from '../shared/sceneContract.mjs'
import {normaliseComposition,compositionKey} from '../shared/compositionContract.mjs'
import type {Composition,CompositionBounds} from '../shared/compositionContract.mjs'
import {decorationKey} from '../shared/bottleBrandingContract.mjs'
import type {BottleDecoration,DecorationPatch} from '../shared/bottleBrandingContract.mjs'
import {prepareLogo} from './logoDelivery'
import {apiUrl} from './apiUrl'

export interface BottlePublicApi {
  setLogo:(file:File|'sample'|null)=>Promise<void>
  setDecoration:(patch:DecorationPatch)=>Promise<void>
  getDecoration:()=>BottleDecoration
  setComposition:(composition:Composition)=>Promise<void>
  getComposition:()=>Composition
  getCompositionBounds:()=>CompositionBounds
  readonly ready:Promise<void>
  readonly viewsReady:Promise<void>
  readonly sceneReady:Promise<void>
  setScene:(scene:SceneSelection)=>Promise<void>
  getScene:()=>SceneRef
  getSceneProfile:()=>SceneProfile|null
  reloadViews:()=>Promise<void>
  getViewCatalog:()=>CameraViewCatalog|null
  setState:(state:BottleState|'a'|'b'|'c')=>Promise<void>
  setCamera:(camera:CameraInput)=>Promise<void>
  getCurrentViewAsImage:()=>Promise<Blob>
  getCamera:()=>CameraSnapshot
  getState:()=>BottleState
  getViews:()=>BottleViewCamera[]
  setSkin:(skin:SkinRef)=>Promise<void>
  getSkin:()=>SkinRef
  getSkins:()=>ReturnType<typeof availableSkins>
}
declare global {interface Window {appName3DVisualisation:BottlePublicApi}}

/** Both HTML controls and console callers enter this exact queue. */
export function createBottlePublicApi(viewer:()=>BottleViewerHandle|null,onBusy:(busy:boolean)=>void,cameraViews:CameraViewsStore) {
  let resolveReady:()=>void=()=>{},rejectReady:(error:Error)=>void=()=>{}
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
  void ready.catch(()=>{})
  let resolveSceneReady:()=>void=()=>{},rejectSceneReady:(error:Error)=>void=()=>{}
  const sceneReady=new Promise<void>((resolve,reject)=>{resolveSceneReady=resolve;rejectSceneReady=reject})
  void sceneReady.catch(()=>{})
  let queue=Promise.resolve(),pending=0,skinSequence=0,sceneSequence=0,logoSequence=0
  const get=()=>{const handle=viewer();if(!handle)throw new Error('Viewer is not ready');return handle}
  function enqueue<T>(action:()=>Promise<T>):Promise<T>{
    pending++;onBusy(true)
    const task=queue.then(()=>ready).then(action)
    const finish=()=>{pending--;onBusy(pending>0)}
    queue=task.then(()=>{finish()},()=>{finish()})
    return task
  }
  const api:BottlePublicApi={
    getDecoration:()=>get().getDecoration(),
    setDecoration(input){try{const patch=structuredClone(input);return enqueue(()=>get().setDecoration(patch))}catch(error){return Promise.reject(error)}},
    setLogo(file){
      const serial=++logoSequence
      return enqueue(async()=>{
        if(serial!==logoSequence)throw new DOMException('Logo request superseded','AbortError')
        const next=await prepareLogo(file)
        if(serial!==logoSequence)throw new DOMException('Logo request superseded','AbortError')
        return get().setLogo(next.asset,next.ref)
      })
    },
    getComposition:()=>get().getComposition(),
    getCompositionBounds:()=>get().getCompositionBounds(),
    setComposition(input){try{const next=normaliseComposition(input);return enqueue(()=>get().setComposition(next))}catch(error){return Promise.reject(error)}},
    ready,
    sceneReady,
    getScene:()=>get().getScene(),
    getSceneProfile:()=>get().getSceneProfile(),
    setScene(input){
      try{
        const next=normaliseSceneSelection(input),sequence=++sceneSequence
        viewer()?.cancelScene()
        return enqueue(()=>{
          if(sequence!==sceneSequence)throw new DOMException('Scene request superseded','AbortError')
          return get().setScene(next)
        })
      }catch(error){return Promise.reject(error)}
    },
    get viewsReady(){return cameraViews.ready},
    reloadViews:()=>cameraViews.reload(),
    getViewCatalog:()=>structuredClone(cameraViews.getSnapshot().catalog),
    setSkin(input){
      try{
        const next=normaliseSkin(input),sequence=++skinSequence
        viewer()?.cancelSkin()
        return enqueue(()=>{
          if(sequence!==skinSequence)throw new DOMException('Skin request superseded','AbortError')
          return get().setSkin(next)
        })
      }catch(error){return Promise.reject(error)}
    },
    getSkin:()=>get().getSkin(),
    getSkins:availableSkins,
    setState(state){
      try{const next=normaliseState(state);return enqueue(()=>get().setState(next))}catch(error){return Promise.reject(error)}
    },
    setCamera(camera){
      try{const next=validateCamera(camera);return enqueue(()=>get().setCamera(next))}catch(error){return Promise.reject(error)}
    },
    getCurrentViewAsImage(){return enqueue(async()=>{
      const handle=get()
      const scene=handle.getScene(),composition=handle.getComposition(),decoration=handle.getDecoration(),request={version:RENDER_VERSION,product:'bottle',state:handle.getState(),skin:handle.getSkin(),scene,composition,decoration,camera:handle.getCamera(),image:handle.imageSize()}
      const compositionHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(compositionKey(composition)))),n=>n.toString(16).padStart(2,'0')).join('')
      const decorationHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(decorationKey(decoration)))),n=>n.toString(16).padStart(2,'0')).join('')
      const response=await fetch(apiUrl('render'),{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(120_000),
      })
      if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error??`Render failed (${response.status})`)}
      if(!response.headers.get('Content-Type')?.startsWith('image/png')||response.headers.get('X-Render-Engine')!=='server-chromium')throw new Error('Invalid render response')
      if(response.headers.get('X-Render-Scene')!==scene.id+'@'+scene.revision||response.headers.get('X-Render-Scene-SHA256')!==scene.sha256)throw new Error('Render scene mismatch')
      if(response.headers.get('X-Render-Composition-SHA256')!==compositionHash)throw new Error('Render composition mismatch')
      if(response.headers.get('X-Render-Decoration-SHA256')!==decorationHash)throw new Error('Render decoration mismatch')
      return response.blob()
    })},
    getCamera:()=>get().getCamera(),getState:()=>get().getState(),getViews:()=>get().getViews(),
  }
  return {api,resolveReady,rejectReady,resolveSceneReady,rejectSceneReady}
}

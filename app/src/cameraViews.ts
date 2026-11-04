import {CAMERA_VIEWS_MAX_BYTES,validateCameraViews} from '../shared/cameraViewsContract.mjs'
import type {CameraViewCatalog} from '../shared/cameraViewsContract.mjs'

export interface CameraViewsSnapshot {status:'loading'|'refreshing'|'ready'|'error';catalog:CameraViewCatalog|null;error:string|null}
export interface CameraViewsStore {
  readonly ready:Promise<void>
  getSnapshot:()=>CameraViewsSnapshot
  subscribe:(listener:()=>void)=>()=>void
  reload:()=>Promise<void>
  dispose:()=>void
}
function deferred(){
  let resolve:()=>void=()=>{},reject:(error:unknown)=>void=()=>{}
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
  void promise.catch(()=>{})
  return {promise,resolve,reject}
}
export function createCameraViewsStore(endpoint:string,fetcher:typeof fetch=fetch):CameraViewsStore{
  let snapshot:CameraViewsSnapshot=Object.freeze({status:'loading',catalog:null,error:null})
  let attempt=deferred(),started=false,closed=false,generation=0,active:AbortController|null=null
  const listeners=new Set<()=>void>()
  const publish=(next:CameraViewsSnapshot)=>{snapshot=Object.freeze(next);listeners.forEach(listener=>listener())}
  return {
    get ready(){return attempt.promise},
    getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener)}},
    reload(){
      if(closed)return Promise.reject(new Error('Camera catalog was closed'))
      const serial=++generation
      active?.abort(new DOMException('Camera catalog request superseded','AbortError'))
      if(started)attempt=deferred()
      started=true
      const current=attempt,controller=new AbortController();active=controller
      publish({status:snapshot.catalog?'refreshing':'loading',catalog:snapshot.catalog,error:null})
      void (async()=>{
        try{
          const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)])
          const response=await fetcher(endpoint,{signal,cache:'no-store',priority:'high',headers:{Accept:'application/json'}})
          if(!response.ok)throw new Error('Camera catalog HTTP '+response.status)
          const text=await response.text()
          if(new TextEncoder().encode(text).length>CAMERA_VIEWS_MAX_BYTES)throw new Error('Camera catalog is too large')
          const catalog=validateCameraViews(JSON.parse(text))
          if(closed||serial!==generation||controller.signal.aborted)throw new DOMException('Camera catalog request superseded','AbortError')
          publish({status:'ready',catalog,error:null});current.resolve()
        }catch(error){
          if(!closed&&serial===generation&&!controller.signal.aborted)publish({status:'error',catalog:snapshot.catalog,error:'Die Ansichten konnten nicht geladen werden.'})
          current.reject(error)
        }finally{if(active===controller)active=null}
      })()
      return current.promise
    },
    dispose(){if(closed)return;closed=true;generation++;active?.abort(new DOMException('Camera catalog was closed','AbortError'));attempt.reject(new Error('Camera catalog was closed'));listeners.clear()},
  }
}

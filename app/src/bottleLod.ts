import { SKIN_REGISTRY } from '../shared/skinContract.mjs'
import { BOTTLE } from './bottle'

export const BOTTLE_LOW={...BOTTLE,assetUrl:import.meta.env.BASE_URL+SKIN_REGISTRY.geometry.low.file+'?v='+SKIN_REGISTRY.geometry.low.sha256.slice(0,12)}
export const BOTTLE_BACKGROUND_DOWNLOAD={priority:'low' as const,partSize:256*1024,concurrency:1,timeoutMs:30_000}

/** Yield uploads and shader work to input and painting. No background download
 * starts until the low model has actually reached the screen. */
export function nextPaint(signal:AbortSignal):Promise<void>{
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    let frame=0
    const abort=()=>{cancelAnimationFrame(frame);reject(signal.reason)}
    signal.addEventListener('abort',abort,{once:true})
    frame=requestAnimationFrame(()=>{signal.removeEventListener('abort',abort);resolve()})
  })
}
export async function idleTurn(signal:AbortSignal){
  await nextPaint(signal)
  signal.throwIfAborted()
  if('requestIdleCallback' in window)await new Promise<void>((resolve,reject)=>{
    const id=window.requestIdleCallback(()=>{signal.removeEventListener('abort',abort);resolve()},{timeout:250})
    const abort=()=>{window.cancelIdleCallback(id);reject(signal.reason)}
    signal.addEventListener('abort',abort,{once:true})
  })
}

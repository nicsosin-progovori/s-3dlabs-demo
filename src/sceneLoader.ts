import {SCENE_MAX_BYTES,freezeScene,normaliseSceneSelection,normaliseSceneRef,validateSceneProfile} from '../shared/sceneContract.mjs'
import type {SceneBundle,SceneRef,SceneSelection} from '../shared/sceneContract.mjs'
import {apiUrl} from './apiUrl.ts'

/** Independently delivered data. No model, skin or camera-catalogue dependency. */
export async function loadScene(input:SceneSelection|SceneRef|null,signal:AbortSignal,fetcher:typeof fetch=fetch,baseUrl=location.href):Promise<SceneBundle>{
  const selection=input?normaliseSceneSelection({id:input.id,revision:input.revision}):null,expected=input&&'sha256'in input?normaliseSceneRef(input):null
  const url=apiUrl(selection?`scenes/${selection.id}/${selection.revision}`:'scenes/default',baseUrl)
  const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),cache:'no-store',priority:'high',headers:{Accept:'application/json'}})
  if(!response.ok)throw Error('Scene HTTP '+response.status)
  const bytes=await response.arrayBuffer()
  if(bytes.byteLength>SCENE_MAX_BYTES)throw Error('Scene is too large')
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
  if(response.headers.get('X-Scene-SHA256')!==sha256||expected&&expected.sha256!==sha256)throw Error('Scene hash mismatch')
  const profile=validateSceneProfile(JSON.parse(new TextDecoder().decode(bytes)))
  if(selection&&(profile.id!==selection.id||profile.revision!==selection.revision))throw Error('Scene identity mismatch')
  signal.throwIfAborted()
  return freezeScene({ref:{id:profile.id,revision:profile.revision,sha256},profile})
}

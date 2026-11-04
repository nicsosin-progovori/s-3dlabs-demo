import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {SCENE_MAX_BYTES,normaliseSceneSelection,normaliseSceneRef,validateSceneProfile} from '../shared/sceneContract.mjs'

export class SceneError extends Error {constructor(status,message){super(message);this.status=status}}
export async function readScene(root,input){
  const selection=normaliseSceneSelection({id:input.id,revision:input.revision})
  const expected=input.sha256===undefined?null:normaliseSceneRef(input)
  try{
    const bytes=await readFile(path.join(root,selection.id,selection.revision,'scene.json'))
    if(bytes.length>SCENE_MAX_BYTES)throw Error('Scene too large')
    const profile=validateSceneProfile(JSON.parse(bytes.toString('utf8')))
    if(profile.id!==selection.id||profile.revision!==selection.revision)throw Error('Scene identity mismatch')
    const ref={...selection,sha256:createHash('sha256').update(bytes).digest('hex')}
    if(expected&&expected.sha256!==ref.sha256)throw new SceneError(409,'Die Szenenversion stimmt nicht überein. Bitte die Szene neu laden.')
    return {bytes,profile,ref}
  }catch(error){
    if(error instanceof SceneError)throw error
    throw new SceneError(error.code==='ENOENT'?404:503,'Die Szene konnte nicht geladen werden.')
  }
}
export async function readDefaultScene(root){
  try{
    const bytes=await readFile(path.join(root,'default.json'))
    if(bytes.length>512)throw Error('Default scene pointer too large')
    return await readScene(root,normaliseSceneSelection(JSON.parse(bytes.toString('utf8'))))
  }catch(error){if(error instanceof SceneError)throw error;throw new SceneError(503,'Die Szene konnte nicht geladen werden.')}
}
export async function serveScene(request,response,root,selection){
  const send=(status,body,headers={})=>{const bytes=Buffer.from(JSON.stringify(body));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store',...headers});response.end(request.method==='HEAD'?undefined:bytes)}
  if(!['GET','HEAD'].includes(request.method)){send(405,{error:'Method not allowed'},{Allow:'GET, HEAD'});return}
  try{
    const {bytes,ref}=selection?await readScene(root,selection):await readDefaultScene(root),etag='"'+ref.sha256+'"'
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache',ETag:etag,'X-Scene-SHA256':ref.sha256,'X-Scene-Revision':ref.revision,'X-Content-Type-Options':'nosniff'}
    if(request.headers['if-none-match']===etag){response.writeHead(304,headers);response.end();return}
    response.writeHead(200,{...headers,'Content-Length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes)
  }catch(error){send(error instanceof SceneError?error.status:400,{error:error instanceof SceneError?error.message:'Invalid scene reference'})}
}

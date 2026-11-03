import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {CAMERA_VIEWS_MAX_BYTES,validateCameraViews} from '../shared/cameraViewsContract.mjs'

/** Read on every request: configuration edits need no frontend build or restart. */
export async function readCameraViews(file){
  const bytes=await readFile(file)
  if(bytes.length>CAMERA_VIEWS_MAX_BYTES)throw new Error('Camera catalog is too large')
  return validateCameraViews(JSON.parse(bytes.toString('utf8')))
}
export async function serveCameraViews(request,response,file){
  const send=(status,body,headers={})=>{
    const bytes=Buffer.from(JSON.stringify(body))
    response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers})
    response.end(request.method==='HEAD'?undefined:bytes)
  }
  if(!['GET','HEAD'].includes(request.method)){send(405,{error:'Method not allowed'},{Allow:'GET, HEAD'});return}
  try{
    const catalog=await readCameraViews(file),bytes=Buffer.from(JSON.stringify(catalog))
    const etag='"'+createHash('sha256').update(bytes).digest('hex')+'"'
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache',ETag:etag,'X-Camera-Views-Revision':catalog.revision,'X-Content-Type-Options':'nosniff'}
    if(request.headers['if-none-match']===etag){response.writeHead(304,headers);response.end();return}
    response.writeHead(200,{...headers,'Content-Length':bytes.length})
    response.end(request.method==='HEAD'?undefined:bytes)
  }catch{send(503,{error:'Die Ansichten konnten nicht geladen werden.'})}
}

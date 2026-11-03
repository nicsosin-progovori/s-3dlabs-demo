import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateRenderRequest } from '../shared/renderContract.mjs'
import { createRenderer } from './renderer.mjs'
import {HttpError as RenderError,readRequestBody,assertRequestOrigin} from './http.mjs'
import {serveCameraViews} from './cameraViews.mjs'
import {readScene,serveScene,SceneError} from './scenes.mjs'
import {DEFAULT_SCENE} from '../shared/sceneContract.mjs'
import {createLogoStore} from './logos.mjs'
import {applyApiCors,parseAllowedOrigins} from './cors.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const production=process.argv.includes('--production')
const port=Number(process.env.PORT??5180),host=process.env.HOST??'127.0.0.1'
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT')
const origin=`http://127.0.0.1:${port}`
const dist=path.join(root,'dist')
const sceneRoot=path.join(root,'config/scenes')
const allowedOrigins=parseAllowedOrigins(process.env.BOTTLE_ALLOWED_ORIGINS)
if(production&&!existsSync(path.join(dist,'bottle.html')))throw new Error('Run npm run build before npm start')
const renderer=createRenderer({root,origin})
const logos=createLogoStore({root})
let vite,stopping=false
const json=(response,status,body)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(body))}
async function readJson(request){
  if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new RenderError(415,'Content-Type must be application/json')
  const bytes=await readRequestBody(request,16_384)
  try{return JSON.parse(bytes.toString('utf8'))}catch{throw new RenderError(400,'Invalid JSON')}
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.glb':'model/gltf-binary','.png':'image/png','.woff2':'font/woff2'}
async function staticFile(request,response,pathname,directory=dist){
  let decoded
  try{decoded=decodeURIComponent(pathname==='/'?'/index.html':pathname)}catch{throw new RenderError(400,'Invalid URL encoding')}
  const target=path.resolve(directory,'.'+decoded)
  if(!target.startsWith(directory+path.sep)){json(response,404,{error:'Not found'});return}
  try{
    const info=await stat(target)
    if(!info.isFile())throw new Error('Not a file')
    let start=0,end=info.size-1,status=200
    if(request.headers.range){
      const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range)
      if(!range){response.setHeader('Content-Range',`bytes */${info.size}`);json(response,416,{error:'Invalid byte range'});return}
      start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){response.setHeader('Content-Range',`bytes */${info.size}`);json(response,416,{error:'Unsatisfiable byte range'});return}
      status=206;response.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`)
    }
    const cache=/^\/textures\/[a-f0-9]{64}\.png$/.test(pathname)?'public, max-age=31536000, immutable':'no-cache'
    response.writeHead(status,{'Content-Type':MIME[path.extname(target)]??'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':cache,'X-Content-Type-Options':'nosniff'})
    if(request.method==='HEAD'||info.size===0)response.end()
    else createReadStream(target,{start,end}).on('error',()=>response.destroy()).pipe(response)
  }catch{json(response,404,{error:'Not found'})}
}
const server=createServer(async(request,response)=>{
  try{
    let url
    try{url=new URL(request.url??'/',origin)}catch{throw new RenderError(400,'Invalid request URL')}
    if(url.pathname.startsWith('/api/')&&applyApiCors(request,response,allowedOrigins))return
    if(url.pathname==='/api/logos'){
      if(request.method!=='POST'){response.setHeader('Allow','POST');throw new RenderError(405,'Method not allowed')}
      assertRequestOrigin(request,allowedOrigins)
      json(response,200,await logos.upload(request));return
    }
    const logoRoute=/^\/api\/logos\/([a-f0-9]{64})\.png$/.exec(url.pathname)
    if(logoRoute){await logos.serve(request,response,logoRoute[1]);return}
    if(url.pathname==='/api/scenes/default'){await serveScene(request,response,sceneRoot);return}
    const sceneRoute=/^\/api\/scenes\/([a-z][a-z0-9-]{0,47})\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})$/.exec(url.pathname)
    if(sceneRoute){await serveScene(request,response,sceneRoot,{id:sceneRoute[1],revision:sceneRoute[2]});return}
    if(url.pathname==='/api/camera-views/bottle'){
      await serveCameraViews(request,response,path.join(root,'config/camera-views/bottle.json'));return
    }
    if(url.pathname==='/api/health'){
      if(request.method!=='GET'){response.setHeader('Allow','GET');json(response,405,{error:'Method not allowed'});return}
      json(response,200,{status:'ok',mode:production?'production':'development',renderer:renderer.status()});return
    }
    if(url.pathname==='/api/render'){
      if(request.method!=='POST'){response.setHeader('Allow','POST');json(response,405,{error:'Method not allowed'});return}
      assertRequestOrigin(request,allowedOrigins)
      let job
      try{job=validateRenderRequest(await readJson(request))}catch(error){if(error instanceof RenderError)throw error;throw new RenderError(400,error.message)}
      const scene=await readScene(sceneRoot,job.scene??DEFAULT_SCENE)
      if(job.decoration.logo.kind==='uploaded')await logos.read(job.decoration.logo)
      const result=await renderer.render({...job,scene:scene.ref})
      if(response.destroyed)return
      response.writeHead(200,{'Content-Type':'image/png','Content-Length':result.png.length,'Content-Disposition':`attachment; filename="bottle-${job.state}.png"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Render-Engine':'server-chromium','X-Render-Id':result.id,'X-Render-Skin':result.skin.id+'@'+result.skin.revision,'X-Render-Camera-SHA256':result.cameraHash,'X-Render-Scene':result.scene.id+'@'+result.scene.revision,'X-Render-Scene-SHA256':result.scene.sha256,'X-Render-Composition-SHA256':result.compositionHash,'X-Render-Decoration-SHA256':result.decorationHash})
      response.end(result.png);return
    }
    if(url.pathname.startsWith('/api/')){json(response,404,{error:'Not found'});return}
    if(!['GET','HEAD'].includes(request.method)){response.setHeader('Allow','GET, HEAD');json(response,405,{error:'Method not allowed'});return}
    if(production)await staticFile(request,response,url.pathname)
    else if(/^\/textures\/[a-f0-9]{64}\.png$/.test(url.pathname))await staticFile(request,response,url.pathname,path.join(root,'public'))
    else vite.middlewares(request,response,()=>json(response,404,{error:'Not found'}))
  }catch(error){
    const known=error instanceof RenderError||error instanceof SceneError
    if(!known)console.error('HTTP request failed:',error?.code??error?.name??'Error')
    if(!response.headersSent&&!response.destroyed){
      if(known&&error.status===413){response.setHeader('Connection','close');request.resume()}
      json(response,known?error.status:500,{error:known?error.message:'Internal server error'})
    }
  }
})
server.requestTimeout=130_000;server.headersTimeout=20_000
if(!production){
  const {createServer:createViteServer}=await import('vite')
  vite=await createViteServer({root,server:{middlewareMode:true,ws:{server},watch:{ignored:[path.join(root,'.cache/**'),path.join(root,'dist/**'),path.join(root,'test-results/**')]}},appType:'mpa'})
}
server.listen(port,host,()=>console.log(`Bottle server (${production?'production':'development'}): ${origin}/bottle.html`))
server.on('error',async error=>{console.error(error.message);await renderer.close();await vite?.close();process.exit(1)})
async function stop(){
  if(stopping)return
  stopping=true
  server.close();server.closeAllConnections()
  await renderer.close();await vite?.close()
  process.exit(0)
}
process.on('SIGINT',stop);process.on('SIGTERM',stop)

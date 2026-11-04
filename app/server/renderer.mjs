import {createHash,randomUUID} from 'node:crypto'
import {launchRenderBrowser} from './browser.mjs'
import {sameSkin} from '../shared/skinContract.mjs'
import {sameScene} from '../shared/sceneContract.mjs'
import {compositionKey} from '../shared/compositionContract.mjs'
import {decorationKey} from '../shared/bottleBrandingContract.mjs'
import {HttpError as RenderError} from './http.mjs'
export {HttpError as RenderError} from './http.mjs'

function equalCamera(expected,actual){
  for(const key of ['position','target','quaternion','projectionMatrix']){
    if(!Array.isArray(actual?.[key])||actual[key].length!==expected[key].length||expected[key].some((v,i)=>!Number.isFinite(actual[key][i])||Math.abs(v-actual[key][i])>1e-7))return false
  }
  return ['fov','roll','aspect','near','far','zoom'].every(key=>Number.isFinite(actual[key])&&Math.abs(expected[key]-actual[key])<1e-7)
}
async function settleClose(promise){
  let timer
  try{await Promise.race([promise.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,2000)})])}
  finally{clearTimeout(timer)}
}
export function createRenderer({root,origin,timeoutMs=90_000,maxJobs=3,launchBrowser=launchRenderBrowser}){
  let browserPromise=null,queue=Promise.resolve(),pending=0,completed=0,idleTimer,closed=false
  const shutdown=new AbortController()
  function acquireBrowser(){
    if(!browserPromise){
      const promise=Promise.resolve().then(()=>launchBrowser(root)).then(browser=>{
        browser.on('disconnected',()=>{if(browserPromise===promise)browserPromise=null})
        return browser
      }).catch(error=>{if(browserPromise===promise)browserPromise=null;throw error})
      browserPromise=promise
    }
    return browserPromise
  }
  function abandonBrowser(){
    clearTimeout(idleTimer)
    const promise=browserPromise;browserPromise=null
    return promise?promise.then(browser=>browser.close()).catch(()=>{}):Promise.resolve()
  }
  async function execute(request){
    if(closed)throw new RenderError(503,'Renderer is closed')
    clearTimeout(idleTimer)
    let context,finished=false,abort
    const signal=AbortSignal.any([shutdown.signal,AbortSignal.timeout(timeoutMs)])
    const timeout=new Promise((_,reject)=>{
      abort=()=>reject(shutdown.signal.aborted?shutdown.signal.reason:new RenderError(504,'Die Bildberechnung hat zu lange gedauert. Bitte erneut versuchen.'))
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
    })
    const render=(async()=>{
      const browser=await acquireBrowser();signal.throwIfAborted()
      context=await browser.newContext({viewport:request.image,deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'})
      // A startup that completes after cancellation still owns its cleanup.
      if(finished||signal.aborted){await context.close().catch(()=>{});signal.throwIfAborted();throw new RenderError(503,'Renderer is closed')}
      await context.route('**/*',route=>{
        const url=new URL(route.request().url())
        return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort()
      })
      const page=await context.newPage();signal.throwIfAborted()
      page.setDefaultTimeout(timeoutMs)
      const failed=new Promise((_,reject)=>page.on('pageerror',reject))
      const draw=(async()=>{
        await page.goto(`${origin}/render.html`,{waitUntil:'load',timeout:timeoutMs})
        await page.waitForFunction(()=>typeof window.__bottleRender==='function')
        return page.evaluate(job=>window.__bottleRender(job),request)
      })()
      return Promise.race([draw,failed])
    })()
    try{
      const result=await Promise.race([render,timeout])
      if(!equalCamera(request.camera,result.camera))throw Error('Render camera does not match requested camera')
      if(!result.skin||!sameSkin(request.skin,result.skin))throw Error('Render skin does not match requested skin')
      if(!request.scene||!result.scene||!sameScene(request.scene,result.scene))throw Error('Render scene does not match requested scene')
      if(!result.composition||compositionKey(request.composition)!==compositionKey(result.composition))throw Error('Render composition does not match requested composition')
      if(!result.decoration||decorationKey(request.decoration)!==decorationKey(result.decoration))throw Error('Render decoration does not match requested decoration')
      if(typeof result.image!=='string'||!result.image.startsWith('data:image/png;base64,'))throw Error('Invalid render image')
      const png=Buffer.from(result.image.slice('data:image/png;base64,'.length),'base64')
      if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==request.image.width||png.readUInt32BE(20)!==request.image.height)throw Error('Invalid PNG dimensions')
      completed++
      return {png,id:randomUUID(),skin:result.skin,scene:result.scene,cameraHash:createHash('sha256').update(JSON.stringify(request.camera)).digest('hex'),compositionHash:createHash('sha256').update(compositionKey(result.composition)).digest('hex'),decorationHash:createHash('sha256').update(decorationKey(result.decoration)).digest('hex')}
    }catch(error){
      // A failed/disconnected worker must not poison every later request.
      void abandonBrowser()
      if(error instanceof RenderError)throw error
      console.error('Render failed:',error.message)
      throw new RenderError(503,'Das Bild konnte nicht erstellt werden. Bitte erneut versuchen.')
    }finally{
      finished=true;signal.removeEventListener('abort',abort)
      if(context)await settleClose(context.close())
      if(!closed){idleTimer=setTimeout(()=>void abandonBrowser(),60_000);idleTimer.unref()}
    }
  }
  return {
    render(request){
      if(closed)return Promise.reject(new RenderError(503,'Renderer is closed'))
      if(pending>=maxJobs)return Promise.reject(new RenderError(429,'Die Bildberechnung ist ausgelastet. Bitte später erneut versuchen.'))
      pending++
      const task=queue.then(()=>execute(request))
      queue=task.then(()=>{pending--},()=>{pending--})
      return task
    },
    status:()=>({engine:'server-chromium',pending,completed}),
    async close(){if(closed)return;closed=true;shutdown.abort(new RenderError(503,'Renderer is closed'));await settleClose(abandonBrowser())},
  }
}

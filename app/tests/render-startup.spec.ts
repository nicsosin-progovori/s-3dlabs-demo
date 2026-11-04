import {test,expect,type Page} from '@playwright/test'
import {fileURLToPath} from 'node:url'
import {createRenderer} from '../server/renderer.mjs'
import {launchRenderBrowser} from '../server/browser.mjs'
import {validateRenderRequest} from '../shared/renderContract.mjs'

async function workerJob(page:Page){
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  return validateRenderRequest(await page.evaluate(async()=>{
    const app=window.appName3DVisualisation;await app.ready
    const camera=app.getCamera(),height=600
    return {version:5,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:app.getScene(),composition:app.getComposition(),decoration:app.getDecoration(),camera,image:{width:Math.round(camera.aspect*height),height}}
  }))
}

test('worker performs one beauty pass after the complete shadow accumulation',async({page,context})=>{
  const job=await workerJob(page)
  const expected=await page.evaluate(()=>window.appName3DVisualisation.getSceneProfile()!.settings.shadow.frames)
  const worker=await context.newPage()
  await worker.goto('/render.html');await worker.waitForFunction(()=>typeof window.__bottleRender==='function')
  const result=await worker.evaluate(async job=>{
    await window.__bottleRender(job)
    const canvas=document.querySelector('canvas')!,gl=canvas.getContext('webgl2')!
    return {beautyFrames:Number(canvas.dataset.renderFrames),shadowFrames:Number(canvas.dataset.shadowFrames),attributes:gl.getContextAttributes()}
  },job)
  expect(result.beautyFrames).toBe(1)
  expect(result.shadowFrames).toBe(expected)
  expect(result.attributes).toMatchObject({antialias:false,depth:false})
})

test('worker rejects a lost GPU context instead of returning a black PNG',async({page,context})=>{
  const job=await workerJob(page)
  const worker=await context.newPage()
  await worker.goto('/render.html');await worker.waitForFunction(()=>typeof window.__bottleRender==='function')
  await worker.evaluate(job=>{
    const probe=window as typeof window&{gpuResult:Promise<string>}
    probe.gpuResult=window.__bottleRender(job as Parameters<typeof window.__bottleRender>[0]).then(()=> 'resolved',error=>error.message)
  },job)
  await worker.waitForFunction(()=>!!document.querySelector('canvas')?.dataset.studioInstance)
  await worker.evaluate(()=>{
    const canvas=document.querySelector('canvas')!,gl=canvas.getContext('webgl2')!
    const extension=gl.getExtension('WEBGL_lose_context')
    if(!extension)throw Error('WEBGL_lose_context is required for this test')
    extension.loseContext()
  })
  const result=await worker.evaluate(()=>Promise.race([
    (window as typeof window&{gpuResult:Promise<string>}).gpuResult,
    new Promise<string>(resolve=>setTimeout(()=>resolve('timeout'),2000)),
  ]))
  expect(result).toBe('Render GPU context was lost')
})

test('worker rejects context loss delivered after synchronous PNG readback',async({page,context})=>{
  const job=await workerJob(page),worker=await context.newPage()
  await worker.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL=function(...args){
      const image=original.apply(this,args)
      setTimeout(()=>this.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext(),0)
      return image
    }
  })
  await worker.goto('/render.html');await worker.waitForFunction(()=>typeof window.__bottleRender==='function')
  const result=await worker.evaluate(job=>window.__bottleRender(job).then(()=> 'resolved',error=>error.message),job)
  expect(result).toBe('Render GPU context was lost')
})

test('server startup keeps shadow-baking lights out of the colour-logo beauty pass',async({page})=>{
  const errors:string[]=[]
  const inspect=(origin:string)=>(message:{type:()=>string;text:()=>string})=>{if(message.type()==='error'||/texture units|GL_INVALID|WebGL.*error/i.test(message.text()))errors.push(origin+': '+message.text())}
  page.on('console',inspect('client'));page.on('pageerror',error=>errors.push('client: '+error.message))
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
  await page.locator('input[type=file]').setInputFiles({name:'startup-logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><ellipse cx="180" cy="90" rx="170" ry="78" fill="#f000ff"/><path d="M140 45h80v90h-80z" fill="white"/></svg>')})
  await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-logo-kind','uploaded')
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setDecoration({technique:'digital'});await app.setCamera({...app.getViews().find(view=>view.id==='branding')!.camera,roll:11})})
  const base=await page.evaluate(()=>{const app=window.appName3DVisualisation,camera=app.getCamera(),height=600;return {version:5,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:app.getScene(),composition:app.getComposition(),decoration:app.getDecoration(),camera,image:{width:Math.round(camera.aspect*height),height}}})
  const root=fileURLToPath(new URL('../',import.meta.url))
  const renderer=createRenderer({root,origin:new URL(page.url()).origin,launchBrowser:async()=>{
    const browser=await launchRenderBrowser(root),createContext=browser.newContext.bind(browser)
    browser.newContext=async options=>{
      const context=await createContext(options)
      context.on('page',worker=>{worker.on('console',inspect('worker'));worker.on('pageerror',error=>errors.push('worker: '+error.message))})
      return context
    }
    return browser
  }})
  try{
    for(const enabled of [true,false,true]){
      const result=await renderer.render(validateRenderRequest({...base,decoration:{...base.decoration,enabled}}))
      expect(result.png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(result.png.readUInt32BE(20)).toBe(600)
    }
    expect(errors).toEqual([])
  }finally{await renderer.close()}
})

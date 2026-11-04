import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { validateRenderRequest } from '../shared/renderContract.mjs'
import type { BottlePublicApi } from '../src/bottlePublicApi'

const evidence=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-api')
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})})
async function open(page:import('@playwright/test').Page){
  await page.goto('/bottle.html')
  await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
  await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-ready','true')
}
test('console API changes all states and preset cameras; controls use the same public methods',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await open(page)
  await expect(page.getByTestId('bottle-visualisation').locator('button,input,select,a')).toHaveCount(0)
  await expect(page.locator('.product-picker')).toHaveCount(0)
  await expect(page.locator('input[type=file]')).toHaveCount(1)
  await expect(page.locator('.bottle-colours button')).toHaveCount(9)
  await expect(page.getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'English',exact:true})).toBeVisible()
  const results=await page.evaluate(async()=>{
    const app=window.appName3DVisualisation,results=[]
    for(const state of ['closed','open','lying'] as const){
      await app.setState(state)
      for(const view of app.getViews()){
        await app.setCamera(view.camera)
        const camera=app.getCamera()
        results.push({state:app.getState(),view:view.id,error:Math.max(...camera.position.map((p,i)=>Math.abs(p-view.camera.position[i]))),fov:camera.fov,expectedFov:view.camera.fov})
      }
    }
    await Promise.all([app.setState('a'),app.setState('c'),app.setState('b')])
    return {results,final:app.getState()}
  })
  expect(results.results).toHaveLength(12)
  for(const result of results.results){expect(result.error).toBeLessThan(1e-6);expect(result.fov).toBe(result.expectedFov)}
  expect(results.final).toBe('open')
  await page.evaluate(()=>{
    const app=window.appName3DVisualisation
    const calls:{state:string[];camera:number}={state:[],camera:0}
    ;(window as unknown as {apiCalls:typeof calls}).apiCalls=calls
    const setState=app.setState,setCamera=app.setCamera
    app.setState=next=>{calls.state.push(next);return setState(next)}
    app.setCamera=camera=>{calls.camera++;return setCamera(camera)}
  })
  await page.getByRole('button',{name:'Stehend',exact:true}).click()
  await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-state','closed')
  await expect(page.getByRole('button',{name:'Korpus',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Korpus',exact:true}).click()
  await expect(page.getByRole('button',{name:'Korpus',exact:true})).toHaveAttribute('aria-pressed','true')
  expect(await page.evaluate(()=>(window as unknown as {apiCalls:unknown}).apiCalls)).toEqual({state:['closed'],camera:1})
  expect(errors).toEqual([])
})
test('manual camera is sent to our server; PNG does not depend on client canvas capture',async({page})=>{
  await open(page)
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('open');await app.setCamera({...app.getViews()[0].camera,fov:32,roll:17,zoom:1.1})})
  const canvas=page.getByTestId('bottle-visualisation').locator('canvas')
  const box=(await canvas.boundingBox())!
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5)
  await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:10});await page.mouse.up()
  await expect(page.getByRole('button',{name:'Hero',exact:true})).toHaveAttribute('aria-pressed','false')
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('Client canvas capture forbidden')};HTMLCanvasElement.prototype.toBlob=()=>{throw new Error('Client canvas capture forbidden')}})
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  const blobInfo=await page.evaluate(async()=>{
    const blob=await window.appName3DVisualisation.getCurrentViewAsImage()
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})
    return {type:blob.type,size:blob.size,signature:Array.from(new Uint8Array(await blob.slice(0,8).arrayBuffer())),dataUrl}
  })
  const response=await responsePromise,request=response.request().postDataJSON()
  expect(response.status()).toBe(200)
  expect(response.headers()['x-render-engine']).toBe('server-chromium')
  expect(blobInfo.type).toBe('image/png');expect(blobInfo.size).toBeGreaterThan(10_000)
  expect(blobInfo.signature).toEqual([137,80,78,71,13,10,26,10])
  expect(request.state).toBe('open');expect(request.camera.fov).toBe(32);expect(request.camera.zoom).toBe(1.1)
  expect(Object.keys(request).sort()).toEqual(['camera','composition','decoration','image','product','scene','skin','state','version'])
  expect(request.scene).toEqual(await page.evaluate(()=>window.appName3DVisualisation.getScene()))
  expect(response.headers()['x-render-scene-sha256']).toBe(request.scene.sha256)
  expect(request.skin).toEqual({id:'bottle-black',revision:'v01'})
  expect(response.headers()['x-render-skin']).toBe('bottle-black@v01')
  const digest=createHash('sha256').update(JSON.stringify(validateRenderRequest(request).camera)).digest('hex')
  expect(response.headers()['x-render-camera-sha256']).toBe(digest)
  const image=Buffer.from(blobInfo.dataUrl.split(',')[1],'base64')
  expect(image.readUInt32BE(16)).toBe(request.image.width);expect(image.readUInt32BE(20)).toBe(request.image.height)
  await import('node:fs/promises').then(fs=>fs.writeFile(path.join(evidence,'server-manual-camera.png'),image))
})
test('download button calls public image method and saves a real server PNG',async({page})=>{
  await open(page)
  await page.evaluate(()=>{
    const app=window.appName3DVisualisation,getImage=app.getCurrentViewAsImage
    ;(window as unknown as {imageCalls:number}).imageCalls=0
    app.getCurrentViewAsImage=()=>{(window as unknown as {imageCalls:number}).imageCalls++;return getImage()}
    HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('No client capture')}
  })
  const downloadPromise=page.waitForEvent('download',{timeout:120_000})
  await page.getByRole('button',{name:'PNG herunterladen',exact:true}).click()
  const download=await downloadPromise
  expect(download.suggestedFilename()).toBe('bottle-closed-overview.png')
  await download.saveAs(path.join(evidence,'downloaded-bottle.png'))
  expect(await page.evaluate(()=>(window as unknown as {imageCalls:number}).imageCalls)).toBe(1)
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
  await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true})
})
test('invalid API calls and unavailable backend fail without a client screenshot fallback',async({page,request})=>{
  await open(page)
  expect(await page.evaluate(async()=>{
    const app=window.appName3DVisualisation as BottlePublicApi
    const errors=[]
    for(const run of [()=>app.setState('bad' as 'closed'),()=>app.setCamera({position:[NaN,0,1],target:[0,0,0]})]){
      try{await run();errors.push(false)}catch{errors.push(true)}
    }
    return errors
  })).toEqual([true,true])
  expect((await request.post('/api/render',{data:{version:1,product:'bottle'}})).status()).toBe(400)
  expect((await request.get('/api/render')).status()).toBe(405)
  expect((await request.post('/api/render',{data:'x',headers:{'content-type':'text/plain'}})).status()).toBe(415)
  expect((await request.post('/api/render',{data:'x'.repeat(17000),headers:{'content-type':'application/json'}})).status()).toBe(413)
  expect((await request.post('/api/render',{data:{},headers:{origin:'https://untrusted.invalid'}})).status()).toBe(403)
  await page.route('**/api/render',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Offline'})}))
  await page.getByRole('button',{name:'PNG herunterladen',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('fehlgeschlagen')
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
})
test('responsive layout has no overflow or controls over the rendered image',async({page})=>{
  await open(page)
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000})
    const layout=await page.evaluate(()=>{
      const view=document.querySelector('[data-testid=bottle-visualisation]')!.getBoundingClientRect()
      const panel=document.querySelector('.bottle-control-panel')!,image=document.querySelector('.bottle-image-card')!,p=panel.getBoundingClientRect(),i=image.getBoundingClientRect()
      const axes=Array.from(panel.querySelectorAll('.bottle-panel-title,.bottle-control-section,.bottle-export-section')).map(e=>e.getBoundingClientRect())
      const internalScrollers=[panel,...panel.querySelectorAll('*')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).length
      return {internalScrollers,aligned:axes.every(r=>Math.abs(r.left-axes[0].left)<.1&&Math.abs(r.right-axes[0].right)<.1),cardsAligned:innerWidth<=720?true:Math.abs(p.top-i.top)<.1&&Math.abs(p.bottom-i.bottom)<.1,width:innerWidth,scroll:document.documentElement.scrollWidth,overlaps:Array.from(document.querySelectorAll('button')).filter(button=>{const b=button.getBoundingClientRect();return b.left<view.right&&b.right>view.left&&b.top<view.bottom&&b.bottom>view.top}).length,minButton:Math.min(...Array.from(document.querySelectorAll('.bottle-states button,.bottle-cameras button,.bottle-download')).map(b=>b.getBoundingClientRect().height))}
    })
    expect(layout.internalScrollers).toBe(0);expect(layout.aligned).toBe(true);expect(layout.cardsAligned).toBe(true);expect(layout.scroll).toBeLessThanOrEqual(layout.width);expect(layout.overlaps).toBe(0);expect(layout.minButton).toBeGreaterThanOrEqual(42)
    await page.screenshot({path:path.join(evidence,`width-${width}.png`),fullPage:true})
  }
})
test('original three products and pair routes still load',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  for(const id of ['bottle','endo','pillow']){
    await page.goto(`/?model=${id}`)
    await expect(page.getByTestId(`${id}-scene`)).toHaveAttribute('data-model-ready','true',{timeout:60_000})
    await expect(page.locator('canvas[data-studio-visible="true"]')).toHaveCount(1,{timeout:60_000})
    expect(await page.evaluate(()=>typeof window.appName3DVisualisation)).toBe('undefined')
  }
  await page.goto('/?model=bottle&mode=pair&second=pillow')
  await expect(page.getByTestId('pair-scene')).toHaveAttribute('data-model-ready','true',{timeout:60_000})
  await expect(page.getByTestId('pair-scene')).toHaveAttribute('data-config','["bottle","pillow"]')
  expect(errors).toEqual([])
})
test('normal motion and queued console commands finish with a usable camera',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'})
  await open(page)
  await page.evaluate(async()=>{
    const app=window.appName3DVisualisation
    await Promise.all([app.setState('open'),app.setState('lying'),app.setState('closed')])
    await app.setCamera(app.getViews()[1].camera)
  })
  await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-state','closed')
  await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-moving','false')
  await expect(page.getByRole('button',{name:'Korpus',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
})

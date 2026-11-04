import {test,expect} from '@playwright/test'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import registry from '../shared/bottleSkins.json' with {type:'json'}
const hqMetadata=registry.geometry.final

const evidence=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-progressive')
const scene=(page:import('@playwright/test').Page)=>page.getByTestId('bottle-visualisation')
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})})
async function openLow(page:import('@playwright/test').Page){
  await page.goto('/bottle.html')
  await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
  await expect(scene(page)).toHaveAttribute('data-ready','true')
  await expect(scene(page)).toHaveAttribute('data-quality','low')
}
test('low is visible and interactive before HQ starts; prepared HQ retains state, camera and context',async({page})=>{
  let release:()=>void=()=>{},requested=false
  const gate=new Promise<void>(resolve=>{release=resolve})
  const order:string[]=[]
  page.on('request',request=>{if(request.url().includes('.glb'))order.push(new URL(request.url()).pathname)})
  await page.route('**/models/bottle/bottle-geometry-final-v01.glb*',async route=>{requested=true;await gate;await route.continue()})
  await openLow(page)
  await expect.poll(()=>requested).toBe(true)
  await scene(page).screenshot({path:path.join(evidence,'initial-low.png')})
  expect(order[0]).toContain('bottle-geometry-low-v01.glb')
  const times=await scene(page).evaluate(e=>({low:Number(e.getAttribute('data-low-visible-at')),high:Number(e.getAttribute('data-high-request-at'))}))
  expect(times.high).toBeGreaterThan(times.low)
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('lying');await app.setCamera({...app.getViews()[1].camera,roll:11,fov:31})})
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  const instance=await scene(page).locator('canvas').getAttribute('data-studio-instance')
  await scene(page).screenshot({path:path.join(evidence,'01-low.png')})
  release()
  await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  expect(await page.evaluate(()=>window.appName3DVisualisation.getState())).toBe('lying')
  const after=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  for(const field of ['position','target','quaternion','projectionMatrix'] as const)for(let i=0;i<before[field].length;i++)expect(Math.abs(before[field][i]-after[field][i])).toBeLessThan(1e-8)
  expect(after.fov).toBe(before.fov);expect(after.zoom).toBe(before.zoom)
  expect(await scene(page).locator('canvas').getAttribute('data-studio-instance')).toBe(instance)
  await expect(scene(page).locator('canvas')).toHaveAttribute('data-studio-visible','true')
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
  await scene(page).screenshot({path:path.join(evidence,'02-high.png')})
  await page.screenshot({path:path.join(evidence,'page.png'),fullPage:true})
  await writeFile(path.join(evidence,'upgrade.json'),JSON.stringify({order,times,before,after,instance},null,2))
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('closed');await app.setCamera(app.getViews()[0].camera)})
  await scene(page).screenshot({path:path.join(evidence,'initial-high.png')})
})
test('HQ promotion waits for manual orbit to end and does not restore a preset',async({page})=>{
  let release:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/models/bottle/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  await openLow(page)
  const box=(await scene(page).locator('canvas').boundingBox())!
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down()
  await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:8})
  release()
  await expect(scene(page)).toHaveAttribute('data-quality-status','waiting-idle',{timeout:60_000})
  // A download and preparation can finish during the held pointer gesture.
  await expect(scene(page)).toHaveAttribute('data-quality','low')
  await page.mouse.up()
  await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  await expect(page.getByRole('button',{name:'Hero',exact:true})).toHaveAttribute('aria-pressed','false')
})
test('failed HQ keeps the low bottle and all three states usable',async({page})=>{
  await page.route('**/models/bottle/bottle-geometry-final-v01.glb*',route=>route.fulfill({status:503,body:'Unavailable'}))
  await openLow(page)
  await expect(scene(page)).toHaveAttribute('data-quality-status','high-failed',{timeout:30_000})
  for(const state of ['open','lying','closed'] as const)await page.evaluate(state=>window.appName3DVisualisation.setState(state),state)
  await expect(scene(page)).toHaveAttribute('data-quality','low')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
})
test('server PNG still uses HQ while the client HQ download is held',async({page})=>{
  let release:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/models/bottle/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  try{
    await openLow(page)
    await page.evaluate(()=>window.appName3DVisualisation.setState('open'))
    const download=page.waitForEvent('download',{timeout:120_000})
    await page.getByRole('button',{name:'PNG herunterladen',exact:true}).click()
    await (await download).saveAs(path.join(evidence,'hq-server-while-client-low.png'))
    await expect(scene(page)).toHaveAttribute('data-quality','low')
  }finally{release()}
})
test('background bytes are downloaded in small low-priority ranges on the same server',async({page,request})=>{
  const ranges:string[]=[]
  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/models/bottle/bottle-geometry-final-v01.glb'))ranges.push(r.headers().range??'')})
  await page.goto('/bottle.html')
  await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  expect(ranges[0]).toBe('bytes=0-262143')
  expect(ranges.length).toBeGreaterThan(1)
  const response=await request.get('/models/bottle/bottle-geometry-final-v01.glb',{headers:{Range:'bytes=0-127'}})
  expect(response.status()).toBe(206);expect((await response.body()).length).toBe(128)
  expect(response.headers()['content-range']).toBe(`bytes 0-127/${hqMetadata.bytes}`)
  const marker=await request.get('/.nojekyll')
  expect(marker.status()).toBe(200);expect(await marker.body()).toEqual(await readFile('public/.nojekyll'))
  expect((await request.get('/models/bottle/bottle-geometry-final-v01.glb',{headers:{Range:'bytes=99999999-'}})).status()).toBe(416)
})

test('normal-motion HQ maps refine gradually without a blank frame or camera reset',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'})
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error'||/texture units|GL_INVALID|WebGL.*error/i.test(message.text()))errors.push(message.text())})
  let release:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/models/bottle/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  await openLow(page)
  await expect.poll(()=>scene(page).locator('canvas').evaluate(canvas=>Number(getComputedStyle(canvas).opacity))).toBe(1)
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  // Sample every browser frame; a 320 ms refinement can fall between the
  // increasingly spaced locator assertion polls.
  const framesPromise=page.evaluate(()=>new Promise<Array<{progress:number;visible:boolean;status:string|null}>>((resolve,reject)=>{
    const viewer=document.querySelector('[data-testid=bottle-visualisation]')!,canvas=viewer.querySelector('canvas')!
    const frames:Array<{progress:number;visible:boolean;status:string|null}>=[]
    const deadline=performance.now()+60_000
    const sample=()=>{
      const status=viewer.getAttribute('data-quality-status')
      frames.push({progress:Number(canvas.dataset.lodBlend??0),visible:canvas.dataset.studioVisible==='true'&&Number(getComputedStyle(canvas).opacity)===1,status})
      if(status==='high'){resolve(frames);return}
      if(performance.now()>deadline){reject(new Error('Quality transition timed out'));return}
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  release()
  const frames=await framesPromise
  expect(frames.some(frame=>frame.status==='blending-high'&&frame.progress>0&&frame.progress<1)).toBe(true)
  expect(frames.every(frame=>frame.visible)).toBe(true)
  await expect(scene(page).locator('canvas')).toHaveAttribute('data-studio-visible','true')
  await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:30_000})
  const duration=await scene(page).evaluate(e=>Number(e.getAttribute('data-high-ready-at'))-Number(e.getAttribute('data-high-promoted-at')))
  expect(duration).toBeGreaterThanOrEqual(300)
  const after=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  expect(after.position).toEqual(before.position);expect(after.quaternion).toEqual(before.quaternion)
  expect(errors).toEqual([])
})

test('on throttled mobile traffic low becomes usable before the large HQ transfer finishes',async({page})=>{
  test.skip(!process.env.BOTTLE_TEST_URL,'Measure the built frontend, not unminified development modules')
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true})
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:120,downloadThroughput:200_000,uploadThroughput:100_000,connectionType:'cellular4g'})
  const started=Date.now()
  try{
    await openLow(page)
    await expect(scene(page)).toHaveAttribute('data-quality-status','loading-high',{timeout:10_000})
    await page.evaluate(()=>window.appName3DVisualisation.setState('open'))
    await expect(scene(page)).toHaveAttribute('data-quality','low')
    const metrics=await scene(page).evaluate(e=>({lowVisibleAt:Number(e.getAttribute('data-low-visible-at')),highRequestAt:Number(e.getAttribute('data-high-request-at')),quality:e.getAttribute('data-quality'),state:e.getAttribute('data-state')}))
    expect(metrics.highRequestAt).toBeGreaterThan(metrics.lowVisibleAt)
    await writeFile(path.join(evidence,'throttled-network.json'),JSON.stringify({throughputBytesPerSecond:200_000,latencyMs:120,wallUntilInteractiveMs:Date.now()-started,...metrics},null,2))
  }finally{
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
  }
  await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
})

import {test,expect} from '@playwright/test'
import type {Page,Route} from '@playwright/test'
import {readFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import type {SceneProfile} from '../shared/sceneContract.mjs'

const bytes=await readFile(new URL('../config/scenes/source-studio/v01/scene.json',import.meta.url))
const profile=JSON.parse(bytes.toString()) as SceneProfile
const fingerprint=createHash('sha256').update(bytes).digest('hex')
const selection={id:profile.id,revision:profile.revision}
const scene=(page:Page)=>page.getByTestId('bottle-visualisation')
const endpoint='**/api/scenes/default'
async function open(page:Page){await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)}
async function ready(page:Page){await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))}
function variant(revision:string){
  const value=structuredClone(profile);value.revision=revision
  value.settings.key.intensity=.5;value.settings.key.color='#d1e2ff';value.settings.environment.intensity=.55
  value.settings.environment.resolution=256;value.settings.exposure=1.2;value.settings.background={top:'#c0c5d2',bottom:'#e4e7ee'}
  value.settings.shadow.radius=4;value.settings.shadowMap.productResolution=2048;value.settings.shadowMap.groundResolution=1024
  return value
}
async function fulfill(route:Route,value:SceneProfile){
  const body=JSON.stringify(value),hash=createHash('sha256').update(body).digest('hex')
  await route.fulfill({contentType:'application/json',body,headers:{'X-Scene-SHA256':hash}})
}
function sameCamera(a:Record<string,any>,b:Record<string,any>){
  for(const key of ['position','target','quaternion','projectionMatrix'])a[key].forEach((n:number,i:number)=>expect(n).toBeCloseTo(b[key][i],9))
  for(const key of ['fov','roll','near','far','zoom','aspect'])expect(a[key]).toBeCloseTo(b[key],9)
}

test('scene metadata has its own verified API and does not start the render queue',async({request})=>{
  const before=await (await request.get('/api/health')).json(),get=await request.get('/api/scenes/source-studio/v01')
  expect(get.status()).toBe(200);expect(await get.body()).toEqual(bytes);expect(get.headers()['x-scene-sha256']).toBe(fingerprint)
  expect(get.headers()['cache-control']).toBe('no-cache')
  const active=await request.get('/api/scenes/default');expect(active.status()).toBe(200);expect(await active.body()).toEqual(bytes)
  const head=await request.head('/api/scenes/source-studio/v01');expect(head.status()).toBe(200);expect((await head.body()).length).toBe(0)
  expect((await request.get('/api/scenes/source-studio/v01',{headers:{'if-none-match':get.headers().etag}})).status()).toBe(304)
  expect((await request.post('/api/scenes/source-studio/v01',{data:{}})).status()).toBe(405)
  expect((await request.get('/api/scenes/source-studio/absent')).status()).toBe(404)
  expect((await (await request.get('/api/health')).json()).renderer).toEqual(before.renderer)
})
test('geometry and view metadata load while the independent scene request is held; ready waits for the actual studio',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),geometry:string[]=[]
  page.on('request',r=>{if(r.url().includes('bottle-geometry-'))geometry.push(r.url())})
  await page.route(endpoint,async route=>{await gate;await route.continue()})
  try{
    const low=page.waitForResponse(r=>r.url().includes('bottle-geometry-low-')&&r.ok())
    await open(page);await low;await page.evaluate(()=>window.appName3DVisualisation.viewsReady)
    await expect(scene(page)).toHaveAttribute('data-ready','false');await expect(scene(page)).toHaveAttribute('data-scene-status','loading')
    expect(geometry.some(u=>u.includes('final'))).toBe(false)
    await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeDisabled()
  }finally{release()}
  await ready(page);await expect(scene(page)).toHaveAttribute('data-scene-sha256',fingerprint)
})
test('scene metadata becomes available before held GLB and returns isolated profile copies',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/models/bottle/bottle-geometry-low-v01.glb*',async route=>{await gate;await route.continue()})
  try{
    await open(page);await page.evaluate(()=>window.appName3DVisualisation.sceneReady)
    expect(await page.evaluate(()=>window.appName3DVisualisation.getScene())).toEqual({...selection,sha256:fingerprint})
    const actual=await page.evaluate(()=>{const app=window.appName3DVisualisation;app.getSceneProfile()!.settings.exposure=3;return app.getSceneProfile()!.settings.exposure})
    expect(actual).toBe(1);await expect(scene(page)).toHaveAttribute('data-ready','false')
  }finally{release()}
  await ready(page)
})
test('initial scene failure rejects readiness explicitly and never presents fallback lighting as the accepted studio',async({page})=>{
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'Unavailable'}}))
  await open(page)
  expect(await page.evaluate(()=>window.appName3DVisualisation.sceneReady.then(()=>false,()=>true))).toBe(true)
  expect(await page.evaluate(()=>window.appName3DVisualisation.ready.then(()=>false,()=>true))).toBe(true)
  await expect(scene(page)).toHaveAttribute('data-ready','false');await expect(page.getByRole('alert')).toContainText('Studio-Szene')
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeDisabled()
})
test('scene replacement updates light, environment, shadows and CSS without new geometry, skin, camera or context',async({page})=>{
  let assetRequests=0;page.on('request',r=>{if(/\/(models\/|skins\/|textures\/)/.test(new URL(r.url()).pathname))assetRequests++})
  await open(page);await ready(page)
  await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('open');await app.setSkin({id:'bottle-red',revision:'v01'});await app.setCamera({...app.getViews()[1].camera,roll:9})})
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera()),instance=await scene(page).locator('canvas').getAttribute('data-studio-instance'),count=assetRequests
  const custom=variant('qa-blue')
  await page.route('**/api/scenes/source-studio/qa-blue',route=>fulfill(route,custom))
  await page.evaluate(()=>window.appName3DVisualisation.setScene({id:'source-studio',revision:'qa-blue'}))
  const actual=await scene(page).locator('canvas').evaluate(canvas=>JSON.parse(canvas.dataset.studioSignature!))
  expect(actual.key.intensity).toBe(.5);expect(actual.environment.resolution).toBe(256);expect(actual.shadow.radius).toBe(4);expect(actual.shadowMap.productResolution).toBe(2048)
  expect(await page.locator('.bottle-api-page').evaluate(e=>(e as HTMLElement).style.getPropertyValue('--studio-background-top'))).toBe('#c0c5d2')
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  await expect(scene(page)).toHaveAttribute('data-state','open');await expect(scene(page)).toHaveAttribute('data-skin','bottle-red')
  expect(assetRequests).toBe(count);expect(await scene(page).locator('canvas').getAttribute('data-studio-instance')).toBe(instance)
  // A client-only fixture cannot make the real server silently choose another scene.
  const absent=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getCurrentViewAsImage().then(()=>false,()=>true))).toBe(true)
  expect((await absent).status()).toBe(404)
  await page.evaluate(scene=>window.appName3DVisualisation.setScene(scene),selection)
  await expect(scene(page)).toHaveAttribute('data-scene-sha256',fingerprint)
  const rendered=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getCurrentViewAsImage().then(blob=>blob.type))).toBe('image/png')
  const response=await rendered
  expect(response.headers()['x-render-scene']).toBe('source-studio@v01');expect(response.headers()['x-render-scene-sha256']).toBe(fingerprint)
  expect(response.request().postDataJSON().version).toBe(5);expect(response.request().postDataJSON().scene.sha256).toBe(fingerprint)
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
})
test('failed/corrupt updates keep the current studio and stale fingerprints are rejected before PNG rendering',async({page,request})=>{
  await open(page);await ready(page)
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  const corrupt=variant('qa-corrupt')
  await page.route('**/api/scenes/source-studio/qa-corrupt',route=>route.fulfill({json:corrupt,headers:{'X-Scene-SHA256':'0'.repeat(64)}}))
  expect(await page.evaluate(()=>window.appName3DVisualisation.setScene({id:'source-studio',revision:'qa-corrupt'}).then(()=>false,()=>true))).toBe(true)
  expect(await page.evaluate(()=>window.appName3DVisualisation.getScene())).toEqual({...selection,sha256:fingerprint})
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  const job=await page.evaluate(()=>{
    const app=window.appName3DVisualisation,camera=app.getCamera(),height=600,width=Math.round(height*camera.aspect)
    return {version:3,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:{...app.getScene(),sha256:'0'.repeat(64)},camera,image:{width,height}}
  })
  const health=await (await request.get('/api/health')).json()
  expect((await request.post('/api/render',{data:job})).status()).toBe(409)
  expect((await (await request.get('/api/health')).json()).renderer).toEqual(health.renderer)
  await page.evaluate(scene=>window.appName3DVisualisation.setScene(scene),selection)
  await expect(scene(page)).toHaveAttribute('data-scene-status','ready')
})
test('a newer scene request cancels pending data and a late response cannot overwrite it',async({page})=>{
  await open(page);await ready(page)
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/api/scenes/source-studio/qa-slow',async route=>{await gate;await fulfill(route,variant('qa-slow')).catch(()=>{})})
  const started=page.waitForRequest('**/api/scenes/source-studio/qa-slow')
  await page.evaluate(()=>{(window as any).oldScene=window.appName3DVisualisation.setScene({id:'source-studio',revision:'qa-slow'}).then(()=>null,e=>e.name)})
  try{
    await started;await page.evaluate(scene=>window.appName3DVisualisation.setScene(scene),selection)
    expect(await page.evaluate(()=>(window as any).oldScene)).toBe('AbortError')
  }finally{release()}
  await expect(scene(page)).toHaveAttribute('data-scene-sha256',fingerprint)
})
test('applying a new studio waits for an orbit gesture to end',async({page})=>{
  await open(page);await ready(page)
  const box=(await scene(page).locator('canvas').boundingBox())!
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down()
  await page.route('**/api/scenes/source-studio/qa-gesture',route=>fulfill(route,variant('qa-gesture')))
  await page.evaluate(()=>{(window as any).sceneChange=window.appName3DVisualisation.setScene({id:'source-studio',revision:'qa-gesture'})})
  await expect(scene(page)).toHaveAttribute('data-scene-status','waiting-idle')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getScene().revision)).toBe('v01')
  await page.mouse.up();await page.evaluate(()=>(window as any).sceneChange)
  await expect(scene(page)).toHaveAttribute('data-scene-revision','qa-gesture');await expect(scene(page)).toHaveAttribute('data-scene-status','ready')
})
test('a studio applied to low survives the final upgrade with its camera and state',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  await page.route('**/api/scenes/source-studio/qa-low',route=>fulfill(route,variant('qa-low')))
  let before:Record<string,any>
  try{
    await open(page);await ready(page)
    await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('lying');await app.setScene({id:'source-studio',revision:'qa-low'});await app.setCamera({...app.getViews()[1].camera,roll:7})})
    await expect(scene(page)).toHaveAttribute('data-quality','low')
    before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  }finally{release()}
  await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before!)
  await expect(scene(page)).toHaveAttribute('data-scene-revision','qa-low');await expect(scene(page)).toHaveAttribute('data-state','lying')
  const out=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-scenes-v01/production')
  await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'external-scene-low-final.png'),fullPage:true})
})

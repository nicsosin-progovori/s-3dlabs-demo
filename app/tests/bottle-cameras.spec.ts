import {test,expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import type {CameraViewCatalog} from '../shared/cameraViewsContract.mjs'

const catalog=JSON.parse(await readFile(new URL('../config/camera-views/bottle.json',import.meta.url),'utf8')) as CameraViewCatalog
const scene=(page:Page)=>page.getByTestId('bottle-visualisation')
const group=(page:Page)=>page.getByRole('group',{name:'Perspektive',exact:true})
const endpoint='**/api/camera-views/bottle'
async function api(page:Page){await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)}
async function ready(page:Page){await page.evaluate(()=>window.appName3DVisualisation.ready);await expect(scene(page)).toHaveAttribute('data-ready','true')}
function sameCamera(actual:Record<string,any>,expected:Record<string,any>){
  for(const key of ['position','target','quaternion','projectionMatrix'])actual[key].forEach((value:number,index:number)=>expect(value).toBeCloseTo(expected[key][index],6))
  for(const key of ['fov','roll','near','far','zoom','aspect'])expect(actual[key]).toBeCloseTo(expected[key],6)
}

test('camera metadata API works independently with ETag, HEAD and method checks',async({request})=>{
  const health=await (await request.get('/api/health')).json()
  const response=await request.get('/api/camera-views/bottle')
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/json')
  expect(await response.json()).toEqual(catalog)
  const etag=response.headers().etag
  expect(etag).toMatch(/^"[a-f0-9]{64}"$/);expect(response.headers()['cache-control']).toBe('no-cache')
  const head=await request.head('/api/camera-views/bottle')
  expect(head.status()).toBe(200);expect(head.headers().etag).toBe(etag);expect((await head.body()).length).toBe(0)
  expect((await request.get('/api/camera-views/bottle',{headers:{'If-None-Match':etag}})).status()).toBe(304)
  expect((await request.post('/api/camera-views/bottle',{data:{}})).status()).toBe(405)
  expect((await request.get('/api/camera-views/unknown')).status()).toBe(404)
  expect((await (await request.get('/api/health')).json()).renderer).toEqual(health.renderer)
})
test('view list arrives while GLB is held and does not claim the model is ready',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/models/bottle/bottle-geometry-low-v01.glb*',async route=>{await gate;await route.continue()})
  try{
    await api(page);await page.evaluate(()=>window.appName3DVisualisation.viewsReady)
    expect(await page.evaluate(()=>window.appName3DVisualisation.getViewCatalog()?.revision)).toBe(catalog.revision)
    await expect(group(page).getByRole('button')).toHaveText(['Hero','Korpus','Dreiviertel','Logo'])
    await expect(scene(page)).toHaveAttribute('data-ready','false')
    await expect(group(page).getByRole('button').first()).toBeDisabled()
    expect(await page.evaluate(()=>window.appName3DVisualisation.getViews())).toEqual([])
  }finally{release()}
  await ready(page);await expect(group(page).getByRole('button').first()).toBeEnabled()
  await expect(group(page).getByRole('button').first()).toHaveAttribute('aria-pressed','true')
})
test('a delayed catalogue does not block states or manual camera and cannot reset them on arrival',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route(endpoint,async route=>{await gate;await route.fulfill({json:catalog})})
  let before:Record<string,any>
  try{
    await api(page);await ready(page)
    await expect(group(page).getByRole('button')).toHaveCount(0)
    await page.evaluate(async()=>{
      const app=window.appName3DVisualisation;await app.setState('open')
      await app.setCamera({...app.getCamera(),position:[3.2,2.5,8.1],target:[0,1.1,0],fov:31,roll:11})
    })
    before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  }finally{release()}
  await page.evaluate(()=>window.appName3DVisualisation.viewsReady)
  await expect(group(page)).toHaveAttribute('data-views-status','ready')
  await expect(group(page).getByRole('button')).toHaveText(['Hero','Korpus','Von oben','Logo'])
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before!)
  expect(await page.evaluate(()=>window.appName3DVisualisation.getState())).toBe('open')
  await expect(group(page).locator('[aria-pressed=true]')).toHaveCount(0)
})
test('catalogue failure leaves a usable model, selected skin and actual-camera server PNG; reload recovers',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'Unavailable'}}))
  await api(page);await ready(page)
  expect(await page.evaluate(()=>window.appName3DVisualisation.viewsReady.then(()=>false,()=>true))).toBe(true)
  await expect(group(page).getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Ansichten')
  await page.evaluate(async()=>{
    const app=window.appName3DVisualisation;await app.setState('lying');await app.setSkin({id:'bottle-red',revision:'v01'})
    await app.setCamera({position:[2.8,2.2,7.5],target:[0,1,0],fov:29,roll:-7,near:.03,far:90,zoom:1.05})
  })
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  const rendered=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  const image=await page.evaluate(async()=>{const blob=await window.appName3DVisualisation.getCurrentViewAsImage();return {size:blob.size,type:blob.type}})
  const response=await rendered
  expect(response.status()).toBe(200);expect(response.headers()['x-render-skin']).toBe('bottle-red@v01')
  expect(image.type).toBe('image/png');expect(image.size).toBeGreaterThan(10000)
  sameCamera(response.request().postDataJSON().camera,before)
  await page.unroute(endpoint)
  await page.evaluate(()=>window.appName3DVisualisation.reloadViews())
  await expect(group(page).getByRole('button')).toHaveCount(4);await expect(page.getByRole('alert')).toHaveCount(0)
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  await expect(scene(page)).toHaveAttribute('data-state','lying');await expect(scene(page)).toHaveAttribute('data-skin','bottle-red')
  expect(errors).toEqual([])
})
test('external IDs, labels, order, defaults and optics drive buttons; refresh preserves model, camera and skin',async({page})=>{
  let next=structuredClone(catalog)
  next.revision='custom-v1'
  for(const state of Object.values(next.states)){
    const source=state.views[0]
    state.views=[{...structuredClone(source),id:'custom-angle',label:{de:'Eigene Kamera',en:'Custom camera'},camera:{...source.camera,azimuth:77,elevation:.42,fov:29,roll:13,near:.05,far:80,zoom:1.1}},state.views[3]]
    state.defaultView='custom-angle'
  }
  let assetRequests=0
  page.on('request',request=>{if(/\/(models\/|skins\/|textures\/)/.test(new URL(request.url()).pathname))assetRequests++})
  await page.route(endpoint,route=>route.fulfill({json:next}))
  await api(page);await ready(page);await page.evaluate(()=>window.appName3DVisualisation.viewsReady)
  await expect(group(page).getByRole('button')).toHaveText(['Eigene Kamera','Logo'])
  await page.evaluate(()=>{
    const app=window.appName3DVisualisation,setCamera=app.setCamera
    ;(window as any).cameraCalls=0
    app.setCamera=input=>{(window as any).cameraCalls++;return setCamera(input)}
    const copy=app.getViewCatalog()!;copy.states.closed.views.length=0
  })
  expect(await page.evaluate(()=>window.appName3DVisualisation.getViewCatalog()!.states.closed.views.length)).toBe(2)
  await group(page).getByRole('button',{name:'Eigene Kamera',exact:true}).click()
  await expect(group(page).getByRole('button').first()).toHaveAttribute('aria-pressed','true')
  expect(await page.evaluate(()=>(window as any).cameraCalls)).toBe(1)
  const actual=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  expect(actual.fov).toBe(29);expect(actual.roll).toBeCloseTo(13,6);expect(actual.near).toBe(.05);expect(actual.far).toBe(80);expect(actual.zoom).toBe(1.1)
  await page.evaluate(async()=>{
    const app=window.appName3DVisualisation;await app.setState('open');await app.setSkin({id:'bottle-blue',revision:'v01'})
    await app.setCamera({...app.getCamera(),position:[3,2.1,8],target:[0,1.1,0],roll:9})
    ;(document.querySelector('[data-testid=bottle-visualisation] canvas') as any).cameraReloadMarker='same-canvas'
  })
  await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera()),count=assetRequests
  next=structuredClone(next);next.revision='custom-v2'
  for(const state of Object.values(next.states)){state.views.reverse();state.views[1].label.de='Neuer Blick';state.views[1].camera.azimuth=-56}
  await page.evaluate(()=>window.appName3DVisualisation.reloadViews())
  await expect(group(page)).toHaveAttribute('data-views-revision','custom-v2')
  await expect(group(page).getByRole('button')).toHaveText(['Logo','Neuer Blick'])
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  expect(await page.evaluate(()=>(document.querySelector('[data-testid=bottle-visualisation] canvas') as any).cameraReloadMarker)).toBe('same-canvas')
  expect(assetRequests).toBe(count)
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-blue');await expect(scene(page)).toHaveAttribute('data-state','open')
  const evidence=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-cameras-v01')
  await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'external-camera-catalogue.png'),fullPage:true})
})
test('invalid refresh retains the last valid list and the actual camera',async({page})=>{
  await api(page);await ready(page);await page.evaluate(()=>window.appName3DVisualisation.viewsReady)
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setCamera(app.getViews()[1].camera)})
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  await page.route(endpoint,route=>route.fulfill({json:{...catalog,schemaVersion:99}}))
  expect(await page.evaluate(()=>window.appName3DVisualisation.reloadViews().then(()=>false,()=>true))).toBe(true)
  await expect(group(page).getByRole('button')).toHaveText(['Hero','Korpus','Dreiviertel','Logo'])
  await expect(group(page).getByRole('button',{name:'Korpus',exact:true})).toBeEnabled()
  await expect(group(page)).toHaveAttribute('data-views-status','error')
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
})

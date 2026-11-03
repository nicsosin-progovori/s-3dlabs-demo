import {test,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import registry from '../shared/bottleSkins.json' with {type:'json'}

const evidence=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-skins')
const scene=(page:import('@playwright/test').Page)=>page.getByTestId('bottle-visualisation')
const ref=(id:string)=>({id:'bottle-'+id,revision:'v01'})
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})})
async function open(page:import('@playwright/test').Page){
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
}
test('all nine independent skins keep geometry, pose, camera and shared texture downloads',async({page,request})=>{
  const requests:string[]=[],errors:string[]=[]
  page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  expect(requests.filter(u=>u.endsWith('/skin.json'))).toEqual(['/skins/bottle/bottle-black/v01/skin.json'])
  const geometry=requests.filter(u=>u.endsWith('.glb')),maps=requests.filter(u=>u.startsWith('/textures/'))
  expect(new Set(geometry).size).toBe(2);expect(maps).toHaveLength(14)
  expect(geometry.every(u=>u.includes('bottle-geometry-'))).toBe(true)
  const manifest=await request.get('/'+registry.skins[0].file).then(r=>r.json())
  const image=await request.get('/'+manifest.profiles.low.images[0].file)
  expect(image.headers()['cache-control']).toContain('immutable')
  expect(image.headers()['content-type']).toBe('image/png')
  const instance=await scene(page).locator('canvas').getAttribute('data-studio-instance')
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('open');await app.setCamera({...app.getViews()[3].camera,roll:9,fov:31})})
  const camera=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  const gpuBefore=await scene(page).locator('canvas').evaluate(c=>({textures:Number(c.dataset.gpuTextures),geometries:Number(c.dataset.gpuGeometries)}))
  const available=await page.evaluate(()=>window.appName3DVisualisation.getSkins())
  expect(available).toHaveLength(9)
  for(const skin of available){
    await page.evaluate(s=>window.appName3DVisualisation.setSkin(s),skin)
    expect(await page.evaluate(()=>window.appName3DVisualisation.getSkin())).toEqual({id:skin.id,revision:skin.revision})
    const current=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
    // OrbitControls can round-trip a settled position through spherical
    // coordinates by ~1e-16. Still reject any camera movement above 1e-12.
    for(const key of ['position','target','quaternion','projectionMatrix'] as const)current[key].forEach((value,index)=>expect(value).toBeCloseTo(camera[key][index],12))
    for(const key of ['fov','roll','near','far','zoom','aspect'] as const)expect(current[key]).toBeCloseTo(camera[key],12)
    expect(await page.evaluate(()=>window.appName3DVisualisation.getState())).toBe('open')
  }
  expect(requests.filter(u=>u.endsWith('.glb'))).toEqual(geometry)
  expect(requests.filter(u=>u.startsWith('/textures/'))).toEqual(maps)
  const gpuAfter=await scene(page).locator('canvas').evaluate(c=>({textures:Number(c.dataset.gpuTextures),geometries:Number(c.dataset.gpuGeometries)}))
  expect(gpuAfter.textures).toBeLessThanOrEqual(gpuBefore.textures+2)
  expect(gpuAfter.geometries).toBeLessThanOrEqual(gpuBefore.geometries+2)
  await writeFile(path.join(evidence,'skin-switching.json'),JSON.stringify({skins:available.length,geometryRequests:geometry.length,textureRequests:maps.length,gpuBefore,gpuAfter},null,2))
  expect(await scene(page).locator('canvas').getAttribute('data-studio-instance')).toBe(instance)
  expect(errors).toEqual([])
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setState('closed');await app.setSkin({id:'bottle-red',revision:'v01'})})
  await page.screenshot({path:path.join(evidence,'red-page.png'),fullPage:true})
})
test('a skin selected on low survives late final geometry and keeps the camera',async({page})=>{
  let release=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  try{
    await open(page);await expect(scene(page)).toHaveAttribute('data-quality-status','loading-high',{timeout:20_000})
    await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setSkin({id:'bottle-red',revision:'v01'});await app.setState('lying');await app.setCamera({...app.getViews()[1].camera,roll:12})})
    const camera=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
    release();await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
    await expect(scene(page)).toHaveAttribute('data-skin','bottle-red')
    expect(await page.evaluate(()=>window.appName3DVisualisation.getCamera())).toEqual(camera)
    await scene(page).screenshot({path:path.join(evidence,'red-after-final.png')})
  }finally{release()}
})
test('a failed or corrupt skin keeps the previous appearance; a later retry works',async({page})=>{
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  const camera=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  await page.route('**/skins/bottle/bottle-blue/v01/skin.json*',route=>route.fulfill({status:503,body:'Unavailable'}))
  expect(await page.evaluate(async()=>{try{await window.appName3DVisualisation.setSkin({id:'bottle-blue',revision:'v01'});return false}catch{return true}})).toBe(true)
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-black')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getCamera())).toEqual(camera)
  await page.unroute('**/skins/bottle/bottle-blue/v01/skin.json*')
  await page.route('**/skins/bottle/bottle-blue/v01/skin.json*',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}))
  expect(await page.evaluate(async()=>{try{await window.appName3DVisualisation.setSkin({id:'bottle-blue',revision:'v01'});return false}catch{return true}})).toBe(true)
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-black')
  await page.unroute('**/skins/bottle/bottle-blue/v01/skin.json*')
  await page.evaluate(()=>window.appName3DVisualisation.setSkin({id:'bottle-blue',revision:'v01'}))
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-blue')
})
test('a newer skin cancels an in-flight selection; the late response cannot restore it',async({page})=>{
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  let release=()=>{},requested=false
  const gate=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/skins/bottle/bottle-blue/v01/skin.json*',async route=>{requested=true;await gate;try{await route.continue()}catch{/* cancelled request */}})
  try{
    await page.evaluate(()=>{(window as unknown as {firstSkin:Promise<string>}).firstSkin=window.appName3DVisualisation.setSkin({id:'bottle-blue',revision:'v01'}).then(()=>'applied',error=>error.name)})
    await expect.poll(()=>requested).toBe(true)
    await page.evaluate(()=>window.appName3DVisualisation.setSkin({id:'bottle-red',revision:'v01'}))
    expect(await page.evaluate(()=>(window as unknown as {firstSkin:Promise<string>}).firstSkin)).toBe('AbortError')
    release();await expect(scene(page)).toHaveAttribute('data-skin','bottle-red')
  }finally{release()}
})
test('failed final textures keep a skinnable low while backend still renders the chosen final skin',async({page})=>{
  const receipt=JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile('models/bottle/skin-delivery-v01.json','utf8')))
  const failed=receipt.profiles.final.images[0].file
  await page.route('**/'+failed,route=>route.fulfill({status:503,body:'Unavailable'}))
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality-status','high-failed',{timeout:60_000})
  await page.evaluate(()=>window.appName3DVisualisation.setSkin({id:'bottle-red',revision:'v01'}))
  const response=page.waitForResponse(r=>r.url().endsWith('/api/render'))
  const result=await page.evaluate(async()=>{
    const blob=await window.appName3DVisualisation.getCurrentViewAsImage(),bitmap=await createImageBitmap(blob)
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close()
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let red=0
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>50&&pixels[i]>pixels[i+1]*1.5&&pixels[i]>pixels[i+2]*1.5)red++
    return {red,type:blob.type,size:blob.size,skin:window.appName3DVisualisation.getSkin()}
  })
  const rendered=await response
  expect(rendered.status()).toBe(200);expect(rendered.headers()['x-render-skin']).toBe('bottle-red@v01')
  expect(result.red).toBeGreaterThan(1000);expect(result.type).toBe('image/png')
  await writeFile(path.join(evidence,'red-server-while-low.json'),JSON.stringify(result,null,2))
  await expect(scene(page)).toHaveAttribute('data-quality','low')
})
test('unknown skins are rejected by public API and server, including v1 with a skin override',async({page,request})=>{
  await open(page)
  expect(await page.evaluate(async()=>{try{await window.appName3DVisualisation.setSkin({id:'bottle-missing',revision:'v01'});return false}catch{return true}})).toBe(true)
  const camera=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  const height=800,width=Math.round(height*camera.aspect)
  for(const input of [{version:2,skin:{id:'bottle-red',revision:'v99'}},{version:2},{version:1,skin:{id:'bottle-red',revision:'v01'}}]){
    expect((await request.post('/api/render',{data:{...input,product:'bottle',state:'closed',camera,image:{width,height}}})).status()).toBe(400)
  }
  const legacy=await request.post('/api/render',{data:{version:1,product:'bottle',state:'closed',camera,image:{width,height}}})
  expect(legacy.status()).toBe(200);expect(legacy.headers()['x-render-skin']).toBe('bottle-black@v01')
  expect((await legacy.body()).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(registry.skins.length).toBe(9)
})
test('skin application waits for an orbit gesture to finish',async({page})=>{
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality','high',{timeout:60_000})
  const box=(await scene(page).locator('canvas').boundingBox())!
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down()
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:6})
  await page.evaluate(()=>{(window as unknown as {skinChange:Promise<void>}).skinChange=window.appName3DVisualisation.setSkin({id:'bottle-red',revision:'v01'})})
  await expect(scene(page)).toHaveAttribute('data-skin-status','waiting-idle',{timeout:30_000})
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-black')
  await page.mouse.up()
  await page.evaluate(()=>(window as unknown as {skinChange:Promise<void>}).skinChange)
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-red')
  await expect(page.getByRole('button',{name:'Hero',exact:true})).toHaveAttribute('aria-pressed','false')
})
test('an initial low-map failure reports an error and rejects ready instead of hanging',async({page})=>{
  const receipt=JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile('models/bottle/skin-delivery-v01.json','utf8')))
  await page.route('**/'+receipt.profiles.low.images[0].file,route=>route.fulfill({status:503,body:'Unavailable'}))
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  expect(await page.evaluate(()=>window.appName3DVisualisation.ready.then(()=>false,()=>true))).toBe(true)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(scene(page)).toHaveAttribute('data-ready','false')
})

import {test,expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {Matrix4,Quaternion,Vector3} from 'three'
import {DEFAULT_COMPOSITION,compositionKey} from '../shared/compositionContract.mjs'
import type {Composition} from '../shared/compositionContract.mjs'
import type {CameraViewCatalog} from '../shared/cameraViewsContract.mjs'

const catalog=JSON.parse(await readFile(new URL('../config/camera-views/bottle.json',import.meta.url),'utf8')) as CameraViewCatalog
const scene=(page:Page)=>page.getByTestId('bottle-visualisation')
const out=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-composition-v01/production')
test.beforeAll(async()=>{await mkdir(out,{recursive:true})})
function duo():Composition{
  const comp=structuredClone(DEFAULT_COMPOSITION),base=comp.elements[0]
  comp.id='duo';comp.primary='left';comp.root.position=[.035,0,-.015]
  comp.elements=[{...structuredClone(base),id:'left',transform:{position:[-.1,0,0],rotation:[0,-15,0],scale:[1,1,1]}},{...structuredClone(base),id:'right',transform:{position:[.1,0,.015],rotation:[0,20,0],scale:[.85,.85,.85]}}]
  return comp
}
async function open(page:Page,centered=false){
  if(centered){
    const data=structuredClone(catalog);data.schemaVersion=2;delete data.lidStates
    for(const state of Object.values(data.states)){const view=state.views[0];view.camera.subject=[0,0];view.camera.margin=1.12;view.camera.frameTarget='composition'}
    await page.route('**/api/camera-views/bottle',route=>route.fulfill({json:data}))
  }
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
}
function sameCamera(a:Record<string,any>,b:Record<string,any>){
  for(const key of ['position','target','quaternion','projectionMatrix'])a[key].forEach((n:number,i:number)=>expect(n).toBeCloseTo(b[key][i],8))
  for(const key of ['fov','roll','near','far','zoom','aspect'])expect(a[key]).toBeCloseTo(b[key],8)
}
async function assertFramed(page:Page){
  const {camera,bounds}=await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),bounds:window.appName3DVisualisation.getCompositionBounds()}))
  const world=new Matrix4().compose(new Vector3(...camera.position),new Quaternion(...camera.quaternion),new Vector3(1,1,1)),projection=new Matrix4().fromArray(camera.projectionMatrix).multiply(world.invert())
  for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]]){
    const p=new Vector3(x,y,z).applyMatrix4(projection);expect(Math.abs(p.x)).toBeLessThan(1.01);expect(Math.abs(p.y)).toBeLessThan(1.01)
  }
}

test('one-element composition includes the detached cap and exposes isolated geometry-based metrics',async({page})=>{
  await open(page,true)
  const closed=await page.evaluate(()=>window.appName3DVisualisation.getCompositionBounds())
  await page.evaluate(()=>window.appName3DVisualisation.setState('open'))
  const data=await page.evaluate(()=>{
    const app=window.appName3DVisualisation,c=app.getComposition();c.elements.length=0
    return {definition:app.getComposition(),bounds:app.getCompositionBounds(),camera:app.getCamera()}
  })
  expect(data.definition.elements).toHaveLength(1);expect(data.bounds.size[0]).toBeGreaterThan(closed.size[0]);expect(data.bounds.center[0]).toBeGreaterThan(closed.center[0])
  data.camera.target.forEach((n,i)=>expect(n).toBeCloseTo(data.bounds.center[i],6))
  await assertFramed(page)
})
test('translated, rotated and scaled group fits the common center without extra asset requests or a new context',async({page})=>{
  let assets=0;page.on('request',r=>{if(/\/(models\/|skins\/|textures\/)/.test(new URL(r.url()).pathname))assets++})
  await open(page,true);await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  const instance=await scene(page).locator('canvas').getAttribute('data-studio-instance'),before=assets,comp=duo()
  comp.root.rotation=[0,12,0];comp.root.scale=[1.1,1,.95]
  const hidden=structuredClone(comp.elements[1]);hidden.id='hidden';hidden.visible=false;hidden.transform.position=[1,0,0];comp.elements.push(hidden)
  await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),comp)
  const data=await page.evaluate(()=>({definition:window.appName3DVisualisation.getComposition(),bounds:window.appName3DVisualisation.getCompositionBounds(),camera:window.appName3DVisualisation.getCamera()}))
  expect(data.definition).toEqual(comp);data.camera.target.forEach((n,i)=>expect(n).toBeCloseTo(data.bounds.center[i],6))
  expect(data.bounds.max[0]).toBeLessThan(4);expect(data.bounds.size[0]).toBeGreaterThan(2)
  expect(assets).toBe(before);expect(await scene(page).locator('canvas').getAttribute('data-studio-instance')).toBe(instance)
  await expect(scene(page)).toHaveAttribute('data-composition-elements','2');await assertFramed(page)
  await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'group-centered.png'),fullPage:true})
})
test('server PNG receives the whole composition and actually renders both bottle bodies',async({page})=>{
  await open(page,true)
  await page.evaluate(async comp=>{const app=window.appName3DVisualisation;await app.setSkin({id:'bottle-red',revision:'v01'});await app.setComposition(comp)},duo())
  const rendered=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  const result=await page.evaluate(async()=>{
    const blob=await window.appName3DVisualisation.getCurrentViewAsImage(),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d')!
    ctx.drawImage(bitmap,0,0);bitmap.close()
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,mask=new Uint8Array(canvas.width*canvas.height),sizes:number[]=[]
    for(let i=0;i<mask.length;i++){const at=i*4,r=pixels[at],g=pixels[at+1],b=pixels[at+2];if(r>45&&r>1.5*g&&r>1.4*b)mask[i]=1}
    for(let i=0;i<mask.length;i++)if(mask[i]){
      const queue=[i];mask[i]=0;let size=0
      for(let head=0;head<queue.length;head++){
        const at=queue[head];size++
        for(const n of [at-canvas.width,at+canvas.width,...(at%canvas.width?[at-1]:[]),...(at%canvas.width<canvas.width-1?[at+1]:[])])if(n>=0&&n<mask.length&&mask[n]){mask[n]=0;queue.push(n)}
      }
      if(size>1000)sizes.push(size)
    }
    const dataUrl=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as string);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})
    return {sizes,dataUrl}
  })
  const response=await rendered,request=response.request().postDataJSON()
  expect(response.status()).toBe(200);expect(request.version).toBe(5);expect(request.composition).toEqual(duo())
  const expected=createHash('sha256').update(compositionKey(duo())).digest('hex')
  expect(response.headers()['x-render-composition-sha256']).toBe(expected);expect(result.sizes).toHaveLength(2)
  await mkdir(out,{recursive:true});await writeFile(path.join(out,'duo-server.png'),Buffer.from(result.dataUrl.split(',')[1],'base64'))
})
test('detail views follow the selected primary element while the overview keeps the same whole group',async({page})=>{
  await open(page,true);const comp=duo();await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),comp)
  const before=await page.evaluate(()=>window.appName3DVisualisation.getViews())
  comp.primary='right';await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),comp)
  const after=await page.evaluate(()=>window.appName3DVisualisation.getViews())
  expect(after[0].camera).toEqual(before[0].camera)
  expect(after.find(v=>v.id==='branding')!.camera.target[0]).toBeGreaterThan(before.find(v=>v.id==='branding')!.camera.target[0]+1)
  await page.getByRole('button',{name:'Logo',exact:true}).click();await expect(page.getByRole('button',{name:'Logo',exact:true})).toHaveAttribute('aria-pressed','true')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getComposition().primary)).toBe('right')
})
test('composition application waits for a manual gesture to finish',async({page})=>{
  await open(page)
  const box=(await scene(page).locator('canvas').boundingBox())!
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down()
  await page.evaluate(comp=>{(window as any).groupChange=window.appName3DVisualisation.setComposition(comp)},duo())
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeDisabled();await expect(scene(page)).toHaveAttribute('data-composition-elements','1')
  await page.mouse.up();await page.evaluate(()=>(window as any).groupChange)
  await expect(scene(page)).toHaveAttribute('data-composition-elements','2')
})
test('late final retains the group, manually selected camera and skin',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  let before:Record<string,any>
  try{
    await open(page)
    await page.evaluate(async comp=>{const app=window.appName3DVisualisation;await app.setComposition(comp);await app.setState('open');await app.setSkin({id:'bottle-blue',revision:'v01'});await app.setCamera({...app.getViews()[0].camera,roll:7,fov:30})},duo())
    await expect(scene(page)).toHaveAttribute('data-quality','low');before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  }finally{release()}
  await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before!)
  expect(await page.evaluate(()=>window.appName3DVisualisation.getComposition())).toEqual(duo())
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-blue');await expect(scene(page)).toHaveAttribute('data-state','open')
})
test('normal-motion state transitions finish at fitted group views and remain usable',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await open(page,true)
  await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),duo())
  for(const state of ['open','lying','closed'] as const){
    await page.evaluate(state=>window.appName3DVisualisation.setState(state),state)
    await expect(scene(page)).toHaveAttribute('data-moving','false');await assertFramed(page)
    const {actual,expected}=await page.evaluate(()=>({actual:window.appName3DVisualisation.getCamera(),expected:window.appName3DVisualisation.getViews()[0].camera}))
    actual.position.forEach((n,i)=>expect(n).toBeCloseTo(expected.position[i],6))
    if(state==='open'){await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'group-open.png'),fullPage:true})}
  }
})
test('invalid, unsupported or oversized composition is rejected before changing the current scene',async({page,request})=>{
  await open(page)
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera())
  expect(await page.evaluate(async()=>{
    const app=window.appName3DVisualisation,source=app.getComposition(),results=[]
    for(const change of [(c:any)=>c.elements=[],(c:any)=>c.primary='absent',(c:any)=>c.elements[0].product='endo',(c:any)=>{c.root.scale=[3,3,3];c.elements=[{...c.elements[0],id:'bottle',transform:{position:[-2,0,0],rotation:[0,0,0],scale:[3,3,3]}},{...c.elements[0],id:'second',transform:{position:[2,0,0],rotation:[0,0,0],scale:[3,3,3]}}]}]){
      const next=structuredClone(source);change(next);try{await app.setComposition(next);results.push(false)}catch{results.push(true)}
    }
    return results
  })).toEqual([true,true,true,true])
  expect(await page.evaluate(()=>window.appName3DVisualisation.getComposition())).toEqual(DEFAULT_COMPOSITION)
  sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  const job=await page.evaluate(()=>{const app=window.appName3DVisualisation,camera=app.getCamera(),height=600,width=Math.round(camera.aspect*height);return {version:4,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:app.getScene(),composition:{...app.getComposition(),primary:'absent'},camera,image:{width,height}}})
  expect((await request.post('/api/render',{data:job})).status()).toBe(400)
})
test('group framing follows viewport size and externally delivered target mode',async({page})=>{
  await open(page,true);await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),duo())
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await assertFramed(page)
  }
  const before=await page.evaluate(()=>window.appName3DVisualisation.getCamera()),changed=structuredClone(catalog);changed.schemaVersion=2;delete changed.lidStates;changed.revision='primary-focus'
  for(const state of Object.values(changed.states)){state.views[0].camera.frameTarget='primary';state.views[0].camera.subject=[0,0]}
  await page.unroute('**/api/camera-views/bottle');await page.route('**/api/camera-views/bottle',route=>route.fulfill({json:changed}))
  await page.evaluate(()=>window.appName3DVisualisation.reloadViews());sameCamera(await page.evaluate(()=>window.appName3DVisualisation.getCamera()),before)
  const primary=await page.evaluate(()=>window.appName3DVisualisation.getViews()[0].camera.target),center=await page.evaluate(()=>window.appName3DVisualisation.getCompositionBounds().center)
  expect(primary[0]).toBeLessThan(center[0]-.5)
  await page.getByRole('button',{name:'Hero',exact:true}).click()
  const actual=await page.evaluate(()=>window.appName3DVisualisation.getCamera());actual.target.forEach((n,i)=>expect(n).toBeCloseTo(primary[i],6))
})
test('repeated group replacement releases instance resources without losing the shared model',async({page})=>{
  await open(page);await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  const memory=()=>scene(page).locator('canvas').evaluate(c=>({textures:Number(c.dataset.gpuTextures),geometries:Number(c.dataset.gpuGeometries)}))
  const before=await memory(),instance=await scene(page).locator('canvas').getAttribute('data-studio-instance')
  for(let i=0;i<5;i++){
    await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),duo())
    await page.evaluate(comp=>window.appName3DVisualisation.setComposition(comp),DEFAULT_COMPOSITION)
  }
  const after=await memory();expect(after.textures).toBeLessThanOrEqual(before.textures+2);expect(after.geometries).toBeLessThanOrEqual(before.geometries+2)
  expect(await scene(page).locator('canvas').getAttribute('data-studio-instance')).toBe(instance)
  await expect(scene(page)).toHaveAttribute('data-quality','high');await expect(scene(page)).toHaveAttribute('data-composition-elements','1')
  await writeFile(path.join(out,'composition-resources.json'),JSON.stringify({before,after,changes:10},null,2))
})

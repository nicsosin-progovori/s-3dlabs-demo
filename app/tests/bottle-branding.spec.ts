import {test,expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {decorationKey} from '../shared/bottleBrandingContract.mjs'

const out=path.resolve(process.env.BOTTLE_EVIDENCE_DIR??'.cache/qa/bottle-branding-v01/browser')
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><ellipse cx="180" cy="90" rx="170" ry="78" fill="#f000ff"/><path d="M140 45h80v90h-80z" fill="white"/></svg>')
const scene=(page:Page)=>page.getByTestId('bottle-visualisation')
async function open(page:Page){
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
}
async function upload(page:Page){
  await page.locator('input[type=file]').setInputFiles({name:'brand-test.svg',mimeType:'image/svg+xml',buffer:svg})
  await expect(scene(page)).toHaveAttribute('data-logo-kind','uploaded')
  await expect(page.getByRole('button',{name:'PNG herunterladen',exact:true})).toBeEnabled()
}
async function render(page:Page,name:string){
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/render')&&r.request().method()==='POST')
  const image=await page.evaluate(async()=>{
    const blob=await window.appName3DVisualisation.getCurrentViewAsImage(),data=Array.from(new Uint8Array(await blob.arrayBuffer()))
    const url=URL.createObjectURL(blob),image=new Image();image.src=url;await image.decode()
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
    let magenta=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>125&&pixels[i+2]>125&&pixels[i]>pixels[i+1]*1.7&&pixels[i+2]>pixels[i+1]*1.7)magenta++
    URL.revokeObjectURL(url);return {data,magenta,width:image.width,height:image.height}
  })
  const response=await pending,job=response.request().postDataJSON()
  expect(response.status()).toBe(200);expect(job.version).toBe(5)
  expect(response.headers()['x-render-decoration-sha256']).toBe(createHash('sha256').update(decorationKey(job.decoration)).digest('hex'))
  await writeFile(path.join(out,name+'.png'),Buffer.from(image.data))
  return {...image,job}
}
test.use({actionTimeout:15_000})
test.beforeAll(async()=>{await mkdir(out,{recursive:true})})

test('restored colour, placement and method controls call the public API outside the viewer',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page)
  await expect(scene(page).locator('button,input,select,a')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Eigenes Logo hochladen',exact:true})).toContainText('Eigenes Logo hochladen')
  await page.evaluate(()=>{
    const app=window.appName3DVisualisation,skin=app.setSkin,decoration=app.setDecoration
    ;(window as any).brandingCalls={skin:0,decoration:0};(window as any).originalCanvas=document.querySelector('.bottle-visualisation canvas')
    app.setSkin=value=>{(window as any).brandingCalls.skin++;return skin(value)}
    app.setDecoration=value=>{(window as any).brandingCalls.decoration++;return decoration(value)}
  })
  for(const name of ['Blau','Rot','Weiß','Grün','Orange','Türkis','Mattsilber','Marineblau','Schwarz']){
    const button=page.locator('.bottle-colours').getByRole('button',{name,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(button).toBeEnabled()
  }
  await page.getByRole('combobox',{name:'Verfahren',exact:true}).selectOption('pad')
  await expect(page.getByRole('combobox',{name:'Druckfarben',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Druckfarben',exact:true}).selectOption('4')
  await expect(page.getByRole('combobox',{name:'Verfahren',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Bambusdeckel',exact:true}).click()
  await expect(scene(page)).toHaveAttribute('data-decoration-surface','lid');await expect(page.getByRole('combobox',{name:'Verfahren',exact:true})).toBeEnabled()
  await page.getByRole('combobox',{name:'Verfahren',exact:true}).selectOption('doming');await expect(scene(page)).toHaveAttribute('data-decoration-technique','doming')
  const result=await page.evaluate(()=>({calls:(window as any).brandingCalls,decoration:window.appName3DVisualisation.getDecoration(),canvas:(window as any).originalCanvas===document.querySelector('.bottle-visualisation canvas')}))
  expect(result.calls).toEqual({skin:9,decoration:4});expect(result.decoration.colors).toBe(1);expect(result.canvas).toBe(true);expect(errors).toEqual([])
  await page.screenshot({path:path.join(out,'desktop-de-controls.png'),fullPage:true})
})

test('English translates controls and external camera labels, persists and preserves the scene',async({page})=>{
  await open(page);await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setSkin({id:'bottle-blue',revision:'v01'});await app.setState('open');await app.setCamera(app.getViews()[1].camera);(window as any).languageCamera=app.getCamera();(window as any).languageCanvas=document.querySelector('.bottle-visualisation canvas')})
  await page.getByRole('button',{name:'English',exact:true}).click()
  await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.getByRole('heading',{level:1})).toHaveText('One product. Every perspective.')
  await expect(page.getByRole('button',{name:'Lid removed',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('button',{name:'Body',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeEnabled();await expect(page.locator('.bottle-colour-name')).toHaveText('Blue')
  expect(await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),before:(window as any).languageCamera,same:(window as any).languageCanvas===document.querySelector('.bottle-visualisation canvas')}))).toEqual(expect.objectContaining({same:true}))
  const cameras=await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),before:(window as any).languageCamera}));expect(cameras.camera).toEqual(cameras.before)
  await page.reload();await page.evaluate(()=>window.appName3DVisualisation.ready);await expect(page.locator('html')).toHaveAttribute('lang','en')
  await page.getByRole('button',{name:'Deutsch',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','de')
})

test('custom transparent SVG is separately uploaded and the server PNG uses its pixels and actual camera',async({page})=>{
  await open(page);await upload(page)
  const ref=await page.evaluate(()=>window.appName3DVisualisation.getDecoration().logo);expect(ref.kind).toBe('uploaded')
  if(ref.kind!=='uploaded')throw Error('Missing logo')
  const stored=await page.request.get('/api/logos/'+ref.sha256+'.png');expect(stored.status()).toBe(200)
  expect(createHash('sha256').update(await stored.body()).digest('hex')).toBe(ref.sha256)
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setDecoration({technique:'digital'});await app.setCamera({...app.getViews().find(v=>v.id==='branding')!.camera,roll:11});HTMLCanvasElement.prototype.toDataURL=()=>{throw Error('Client capture forbidden')}})
  const result=await render(page,'custom-digital-body');expect(result.magenta).toBeGreaterThan(200);expect(result.job.decoration.logo).toEqual(ref);expect(result.job.camera.roll).toBeCloseTo(11,7)
  await page.evaluate(()=>window.appName3DVisualisation.setDecoration({enabled:false}));const hidden=await render(page,'custom-disabled');expect(hidden.magenta).toBeLessThan(5)
  expect(await page.evaluate(()=>window.appName3DVisualisation.getDecoration().logo)).toEqual(ref)
  await page.evaluate(()=>window.appName3DVisualisation.setDecoration({enabled:true}));expect((await render(page,'custom-restored')).magenta).toBeGreaterThan(200)
})

test('all previous bottle decoration methods render on their supported surfaces with the custom logo',async({page})=>{
  await open(page);await upload(page)
  for(const [surface,methods] of [['body',['laser','pad','screen','digital','laser360','sublimation']],['lid',['laser','pad','doming']]] as const){
    for(const technique of methods){
      await page.evaluate(async({surface,technique})=>{const app=window.appName3DVisualisation;await app.setDecoration({surface,technique,enabled:true,colors:technique==='pad'?4:1});await app.setCamera(app.getViews().find(v=>v.id==='branding')!.camera)},{surface,technique})
      const result=await render(page,`${surface}-${technique}`);expect(result.data.length).toBeGreaterThan(10_000)
      if(['digital','sublimation','doming','pad'].includes(technique))expect(result.magenta).toBeGreaterThan(50)
    }
  }
})

test('PNG follows logo removal and sample restore through the same public methods',async({page})=>{
  await open(page);await upload(page)
  await page.getByRole('button',{name:'Logo entfernen',exact:true}).click();await expect(scene(page)).toHaveAttribute('data-logo-kind','none')
  await expect(page.getByRole('button',{name:'Beispiellogo',exact:true})).toBeEnabled()
  expect(await page.evaluate(()=>window.appName3DVisualisation.getDecoration().logo)).toEqual({kind:'none'})
  await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setDecoration({technique:'digital'});await app.setCamera(app.getViews().find(v=>v.id==='branding')!.camera)})
  const none=await render(page,'logo-removed');expect(none.magenta).toBeLessThan(5);expect(none.job.decoration.logo.kind).toBe('none')
  await page.getByRole('button',{name:'Beispiellogo',exact:true}).click();await expect(scene(page)).toHaveAttribute('data-logo-kind','sample')
})

test('invalid files and failed uploads keep the previous logo; errors translate with the interface',async({page})=>{
  await open(page);await upload(page);const before=await page.evaluate(()=>window.appName3DVisualisation.getDecoration())
  await page.locator('input[type=file]').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('bad')})
  await expect(page.getByRole('alert')).toContainText('PNG-, JPG-');await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Please choose')
  expect(await page.evaluate(()=>window.appName3DVisualisation.getDecoration())).toEqual(before)
  await page.route('**/api/logos',route=>route.fulfill({status:503,json:{error:'Unavailable'}}))
  await page.locator('input[type=file]').setInputFiles({name:'valid.svg',mimeType:'image/svg+xml',buffer:svg})
  await expect(page.getByRole('alert')).toContainText('could not be uploaded');expect(await page.evaluate(()=>window.appName3DVisualisation.getDecoration())).toEqual(before)
  await page.unroute('**/api/logos')
  expect(await page.evaluate(async()=>{
    const app=window.appName3DVisualisation,results=[]
    for(const file of [new File(['broken'],'bad.png',{type:'image/png'}),new File([new Uint8Array(10*1024*1024+1)],'huge.png',{type:'image/png'})])try{await app.setLogo(file);results.push('wrong')}catch(error){results.push((error as any).code)}
    return results
  })).toEqual(['logoRead','logoSize'])
})

test('a late upload cannot restore a logo after a newer removal',async({page})=>{
  await open(page);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve)
  await page.route('**/api/logos',async route=>{entered();await gate;await route.continue()})
  await page.evaluate(svg=>{(window as any).lateLogo=window.appName3DVisualisation.setLogo(new File([svg],'slow.svg',{type:'image/svg+xml'})).then(()=>'applied',error=>error.name)},svg.toString())
  try{await started;await page.evaluate(()=>{(window as any).removeLogo=window.appName3DVisualisation.setLogo(null)})}finally{release()}
  await page.evaluate(()=>(window as any).removeLogo);expect(await page.evaluate(()=>(window as any).lateLogo)).toBe('AbortError')
  await expect(scene(page)).toHaveAttribute('data-logo-kind','none')
})

test('low to final keeps the custom logo, decoration, skin, state, camera and Canvas',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve)
  await page.route('**/bottle-geometry-final-v01.glb*',async route=>{await gate;await route.continue()})
  let before:any
  try{
    await open(page);await upload(page)
    before=await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setDecoration({surface:'lid',technique:'doming'});await app.setSkin({id:'bottle-red',revision:'v01'});await app.setState('open');await app.setCamera({...app.getViews()[2].camera,roll:8});(window as any).lowCanvas=document.querySelector('.bottle-visualisation canvas');return {camera:app.getCamera(),decoration:app.getDecoration()}})
    await expect(scene(page)).toHaveAttribute('data-quality','low')
  }finally{release()}
  await expect(scene(page)).toHaveAttribute('data-quality-status','high',{timeout:60_000})
  expect(await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),decoration:window.appName3DVisualisation.getDecoration()}))).toEqual(before)
  expect(await page.evaluate(()=>(window as any).lowCanvas===document.querySelector('.bottle-visualisation canvas'))).toBe(true)
  await expect(scene(page)).toHaveAttribute('data-skin','bottle-red');await expect(scene(page)).toHaveAttribute('data-state','open')
  await render(page,'late-final-lid-doming')
})

test('PNG, JPEG and WebP decode through the same delivery path; large artwork is bounded to 2048px',async({page})=>{
  await open(page)
  const result=await page.evaluate(async()=>{
    const app=window.appName3DVisualisation,results=[]
    for(const mime of ['image/png','image/jpeg','image/webp']){
      const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f000ff';ctx.fillRect(10,10,2380,1180)
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),mime))
      await app.setLogo(new File([blob],'test.'+mime.split('/')[1],{type:mime}));results.push(app.getDecoration().logo)
    }return results
  })
  for(const logo of result)expect(logo).toEqual(expect.objectContaining({kind:'uploaded',width:2048,height:1024}))
})

test('mobile controls stay separate, fit the viewport and export remains reachable in English',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);await page.getByRole('button',{name:'English',exact:true}).click()
  await page.getByRole('button',{name:'Bamboo lid',exact:true}).click();await expect(page.getByRole('combobox',{name:'Method',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Method',exact:true}).selectOption('pad')
  await expect(page.getByRole('combobox',{name:'Print colours',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Print colours',exact:true}).selectOption('4')
  await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeEnabled()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(scene(page).locator('button,input,select,a')).toHaveCount(0)
  await page.screenshot({path:path.join(out,'mobile-en-controls.png'),fullPage:true})
})

test('external lid labels/optics drive the UI and metadata refresh preserves the selected custom decoration',async({page})=>{
  await open(page);await upload(page)
  await page.evaluate(()=>window.appName3DVisualisation.setDecoration({surface:'lid',technique:'pad',colors:4}))
  const catalog=await page.evaluate(()=>window.appName3DVisualisation.getViewCatalog())
  if(!catalog?.lidStates)throw Error('Missing lid catalogue')
  catalog.revision='custom-lid';catalog.lidStates.closed.views[2].label={de:'Eigene Deckelkamera',en:'Custom lid view'};catalog.lidStates.closed.views[2].camera.roll=19
  await page.route('**/api/camera-views/bottle',route=>route.fulfill({json:catalog}))
  const before=await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),decoration:window.appName3DVisualisation.getDecoration()}))
  await page.evaluate(()=>window.appName3DVisualisation.reloadViews())
  expect(await page.evaluate(()=>({camera:window.appName3DVisualisation.getCamera(),decoration:window.appName3DVisualisation.getDecoration()}))).toEqual(before)
  await page.getByRole('button',{name:'Eigene Deckelkamera',exact:true}).click();await expect(page.getByRole('button',{name:'Eigene Deckelkamera',exact:true})).toHaveAttribute('aria-pressed','true')
  expect((await page.evaluate(()=>window.appName3DVisualisation.getCamera())).roll).toBeCloseTo(19,7)
  await page.getByRole('button',{name:'English',exact:true}).click();await expect(page.getByRole('button',{name:'Custom lid view',exact:true})).toHaveAttribute('aria-pressed','true')
})

test('malformed/unknown logo references are rejected before the render queue and uploads are same origin',async({page,request})=>{
  await open(page)
  const job=await page.evaluate(()=>{const app=window.appName3DVisualisation,camera=app.getCamera(),height=600,width=Math.round(camera.aspect*height);return {version:5,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:app.getScene(),composition:app.getComposition(),decoration:app.getDecoration(),camera,image:{width,height}}})
  const completed=(await (await request.get('/api/health')).json()).renderer.completed
  for(const [logo,status] of [[{kind:'uploaded',sha256:'a'.repeat(64),width:200,height:100},404],[{kind:'sample',url:'https://external.invalid'},400],[{kind:'uploaded',sha256:'../x',width:200,height:100},400]] as const){
    const response=await request.post('/api/render',{data:{...job,decoration:{...job.decoration,logo}}});expect(response.status()).toBe(status)
  }
  expect((await (await request.get('/api/health')).json()).renderer.completed).toBe(completed)
  expect((await request.post('/api/logos',{headers:{Origin:'https://external.invalid','Content-Type':'image/png'},data:Buffer.from('bad')})).status()).toBe(403)
  expect((await request.post('/api/logos',{headers:{'Content-Type':'image/svg+xml'},data:svg})).status()).toBe(415)
  expect((await request.post('/api/logos',{headers:{'Content-Type':'image/png'},data:svg})).status()).toBe(400)
})

test('custom decoration survives state/skin/composition changes and is rendered on both bottles',async({page})=>{
  await open(page);await upload(page)
  const branding=await page.evaluate(async()=>{const app=window.appName3DVisualisation;await app.setDecoration({surface:'body',technique:'pad',colors:4});return app.getDecoration()})
  await page.evaluate(async()=>{
    const app=window.appName3DVisualisation,group=app.getComposition(),first=group.elements[0];group.id='custom-pair';first.transform.position=[-.12,0,0];group.elements.push({...structuredClone(first),id:'second',transform:{position:[.12,0,0],rotation:[0,0,0],scale:[1,1,1]}})
    await app.setComposition(group);await app.setState('open');await app.setSkin({id:'bottle-blue',revision:'v01'});await app.setScene({id:'source-studio',revision:'v01'});await app.setCamera(app.getViews()[0].camera)
  })
  expect(await page.evaluate(()=>window.appName3DVisualisation.getDecoration())).toEqual(branding)
  const result=await render(page,'custom-two-open-blue');expect(result.job.decoration).toEqual(branding)
  const components=await page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close()
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,mask=new Uint8Array(canvas.width*canvas.height),sizes=[]
    for(let i=0;i<mask.length;i++){const at=i*4,r=rgba[at],g=rgba[at+1],b=rgba[at+2];if(r>125&&b>125&&r>g*1.7&&b>g*1.7)mask[i]=1}
    for(let i=0;i<mask.length;i++)if(mask[i]){
      const queue=[i];mask[i]=0;let size=0
      for(let at=0;at<queue.length;at++){const pixel=queue[at];size++;for(const next of [pixel-canvas.width,pixel+canvas.width,...(pixel%canvas.width?[pixel-1]:[]),...(pixel%canvas.width<canvas.width-1?[pixel+1]:[])])if(next>=0&&next<mask.length&&mask[next]){mask[next]=0;queue.push(next)}}
      if(size>30)sizes.push(size)
    }return sizes
  },result.data)
  expect(components).toHaveLength(2)
})

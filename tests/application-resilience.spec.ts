import {test,expect} from '@playwright/test'

test('healthy product routes and state changes have no React or GPU errors',async({page})=>{
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error'||/texture units|GL_INVALID|WebGL.*error/i.test(message.text()))errors.push(message.text())})
  for(const route of ['/bottle.html','/?model=bottle','/?model=endo','/?model=pillow','/?model=mug','/?model=pen','/?model=notebook']){
    await page.goto(route)
    await expect(page.locator('[data-ready="true"],[data-model-ready="true"]')).toHaveCount(1,{timeout:60_000})
    const states=page.getByRole('group',{name:/^(State|Zustand)$/}).getByRole('button')
    for(const button of await states.all())await button.click()
    if(route==='/bottle.html')await expect(page.getByTestId('bottle-visualisation')).toHaveAttribute('data-quality','high',{timeout:60_000})
  }
  expect(errors).toEqual([])
})

for(const mode of ['read','write'] as const)test('all product routes remain usable when browser storage '+mode+' is denied',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(mode=>{
    if(mode==='read')Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage disabled','SecurityError')}})
    else Storage.prototype.setItem=()=>{throw new DOMException('Storage full','QuotaExceededError')}
  },mode)
  for(const route of ['/bottle.html','/?model=mug','/?model=pen','/?model=notebook','/?model=endo','/?model=pillow']){
    await page.goto(route)
    await expect(page.locator('[data-ready="true"],[data-model-ready="true"]')).toHaveCount(1,{timeout:60_000})
    await page.getByRole('button',{name:'English',exact:true}).click()
    await expect(page.locator('html')).toHaveAttribute('lang','en')
    await expect(page.getByRole('button',{name:'English',exact:true})).toHaveAttribute('aria-pressed','true')
  }
  expect(errors).toEqual([])
})

test('HTTP limits, media types and impossible cameras are rejected before the render queue',async({page,request})=>{
  await page.goto('/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>window.appName3DVisualisation.ready)
  const job=await page.evaluate(()=>{const app=window.appName3DVisualisation,camera=app.getCamera(),height=600,width=Math.round(camera.aspect*height);return {version:5,product:'bottle',state:app.getState(),skin:app.getSkin(),scene:app.getScene(),composition:app.getComposition(),decoration:app.getDecoration(),camera,image:{width,height}}})
  const before=(await (await request.get('/api/health')).json()).renderer.completed
  expect((await request.post('/api/render',{headers:{'Content-Type':'application/json'},data:'{"large":"'+'x'.repeat(20_000)+'"}'})).status()).toBe(413)
  expect((await request.post('/api/render',{headers:{'Content-Type':'application/jsonp'},data:'{}'})).status()).toBe(415)
  expect((await request.post('/api/render',{data:{...job,state:['a']}})).status()).toBe(400)
  expect((await request.post('/api/render',{data:{...job,camera:{...job.camera,projectionMatrix:new Array(16).fill(0)}}})).status()).toBe(400)
  expect((await (await request.get('/api/health')).json()).renderer.completed).toBe(before)
})

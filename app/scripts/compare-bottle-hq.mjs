// Render the real application with identical cameras. Only the private QA
// browser substitutes the protected reference bytes; HTTP/public APIs stay unchanged.
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {launchRenderBrowser} from '../server/browser.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const base=process.env.BOTTLE_TEST_URL??'http://127.0.0.1:5181'
const skins=process.env.BOTTLE_COMPARE_SKINS==='1'
const out=path.join(root,skins?'.cache/qa/bottle-skins-v01/visual':'.cache/qa/bottle-hq-v01/visual')
await mkdir(out,{recursive:true})
const browser=await launchRenderBrowser(root)
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  const page=await context.newPage()
  await page.goto(`${base}/bottle.html`)
  await page.waitForFunction(()=>!!window.appName3DVisualisation)
  await page.evaluate(()=>window.appName3DVisualisation.ready)
  const cases=[]
  for(const [name,state,view,camera] of [
    ['closed-hero','closed',0],
    ['body-macro','closed',3,{position:[0,1.05,2.5],target:[0,1.05,0],fov:26}],
    ['bamboo-macro','closed',0,{position:[0,3.6,1.5],target:[0,2.32,0],fov:26}],
    ['neck-macro','open',0,{position:[.9,2.9,1.2],target:[0,2.02,0],fov:26}],
    ['lying-hero','lying',0],
  ]){
    const request=await page.evaluate(async({state,view,camera})=>{
      const app=window.appName3DVisualisation
      await app.setState(state);await app.setCamera(camera??app.getViews()[view].camera)
      const snapshot=app.getCamera(),height=1000,width=Math.round(height*snapshot.aspect)
      return {version:1,product:'bottle',state,camera:snapshot,image:{width,height}}
    },{state,view,camera})
    cases.push({name,request})
  }
  if(skins)for(const color of ['red','white','silver']){
    const request=await page.evaluate(async color=>{
      const app=window.appName3DVisualisation
      await app.setState('closed');await app.setCamera(app.getViews()[0].camera);await app.setSkin({id:'bottle-'+color,revision:'v01'})
      const camera=app.getCamera(),height=1000,width=Math.round(height*camera.aspect)
      return {version:2,product:'bottle',state:'closed',skin:app.getSkin(),camera,image:{width,height}}
    },color)
    cases.push({name:'closed-'+color,request})
  }
  await context.close()
  for(const quality of ['reference','optimized']){
    const worker=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
    const render=await worker.newPage(),errors=[]
    render.on('pageerror',e=>errors.push(e.message))
    await render.goto(`${base}/render.html`)
    await render.waitForFunction(()=>typeof window.__bottleRender==='function')
    for(const {name,request} of cases){
      await render.setViewportSize(request.image)
      const reference=quality==='reference'?(skins?'embedded-final':'original'):undefined
      const result=await render.evaluate(({request,reference})=>window.__bottleRender(request,reference),{request,reference})
      await writeFile(path.join(out,`${name}-${quality}.png`),Buffer.from(result.image.split(',')[1],'base64'))
      console.log(`${name} ${quality}`)
    }
    if(errors.length)throw new Error(errors.join('\n'))
    await worker.close()
  }
  await writeFile(path.join(out,'cameras.json'),JSON.stringify(cases,null,2))
}finally{await browser.close()}

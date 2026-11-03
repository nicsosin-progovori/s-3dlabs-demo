// Fixed real cameras and server PNGs before/after extracting the studio profile.
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {launchRenderBrowser} from '../server/browser.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),base=process.env.BOTTLE_TEST_URL??'http://127.0.0.1:5181'
const before=process.argv.includes('--before'),out=path.resolve(root,process.env.BOTTLE_COMPARE_OUTPUT??'.cache/qa/bottle-scenes-v01/visual')
await mkdir(out,{recursive:true})
const browser=await launchRenderBrowser(root)
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage()
  let cases
  if(before){
    await page.goto(base+'/bottle.html');await page.waitForFunction(()=>!!window.appName3DVisualisation)
    await page.evaluate(()=>Promise.all([window.appName3DVisualisation.ready,window.appName3DVisualisation.viewsReady]))
    cases=[]
    for(const [name,state,skin,view] of [['closed-hero','closed','black',0],['open-hero','open','black',0],['lying-hero','lying','black',0],['logo-macro','closed','black',3],['silver-hero','closed','silver',0]]){
      const request=await page.evaluate(async({state,skin,view})=>{
        const app=window.appName3DVisualisation
        await app.setState(state);await app.setSkin({id:'bottle-'+skin,revision:'v01'});await app.setCamera(app.getViews()[view].camera)
        const camera=app.getCamera(),height=800,width=Math.round(height*camera.aspect)
        return {version:2,product:'bottle',state,skin:app.getSkin(),camera,image:{width,height}}
      },{state,skin,view})
      cases.push({name,request})
    }
    await writeFile(path.join(out,'cameras.json'),JSON.stringify(cases,null,2))
  }else cases=JSON.parse(await readFile(path.join(out,'cameras.json'),'utf8'))
  const metrics=[]
  for(const {name,request}of cases){
    const response=await fetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(120_000)})
    if(!response.ok)throw Error(await response.text())
    const bytes=Buffer.from(await response.arrayBuffer())
    await writeFile(path.join(out,`${name}-${before?'before':'after'}.png`),bytes)
    if(!before){
      if(!response.headers.get('x-render-scene-sha256'))throw Error('Missing scene provenance')
      const old=await readFile(path.join(out,name+'-before.png'))
      const diff=await page.evaluate(async({a,b})=>{
        const load=async base64=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return {data:x.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height}}
        const x=await load(a),y=await load(b);let sum=0,peak=0,large=0
        if(x.width!==y.width||x.height!==y.height)throw Error('Image size changed')
        for(let i=0;i<x.data.length;i+=4){let d=0;for(let c=0;c<3;c++){const e=Math.abs(x.data[i+c]-y.data[i+c]);sum+=e;peak=Math.max(peak,e);d=Math.max(d,e)}if(d>8)large++}
        return {rgbMae:sum/(x.width*x.height*3),peak,percentOver8:100*large/(x.width*x.height)}
      },{a:old.toString('base64'),b:bytes.toString('base64')})
      metrics.push({name,...diff,scene:response.headers.get('x-render-scene'),sha256:response.headers.get('x-render-scene-sha256')})
    }
    console.log(name+' '+(before?'before':'after'))
  }
  if(!before){await writeFile(path.join(out,'comparison.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics))}
  await context.close()
}finally{await browser.close()}

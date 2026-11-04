import { test, expect as baseExpect } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })
test.setTimeout(120_000)
const expect=baseExpect.configure({timeout:20_000})
const fixture=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect x="10" y="10" width="120" height="140" rx="20" fill="#008bd2"/><path d="m35 80 25 25 45-60" stroke="white" stroke-width="12" fill="none"/><text x="150" y="112" font-size="90" font-family="Arial" font-weight="bold" fill="#d83b44">ACME</text></svg>')

test('independent slots, every bottle/Endo state, live bounds and real 30 mm gap',async({page})=>{
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  // The retained composition experiment starts via Endo. Bottle's own route
  // intentionally opens the focused single-product interface.
  await page.goto('/?model=endo&second=endo')
  await page.getByRole('button',{name:'Isolierflasche',exact:true}).click()
  const scene=page.getByTestId('source-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await expect(scene).toHaveAttribute('data-renderer',/WebGL 2/)
  const config=()=>scene.evaluate(e=>JSON.parse(e.getAttribute('data-config')!))
  const layout=()=>scene.evaluate(e=>JSON.parse(e.getAttribute('data-layout')!))
  for(const bottle of ['Geschlossen','Deckel ab','Liegend']) {
    await page.getByRole('button',{name:'Produkt 1',exact:true}).click()
    await page.getByRole('button',{name:bottle,exact:true}).click()
    for(const endo of ['Am Handgelenk','Ausgebreitet','Box geschlossen','Box geöffnet']) {
      await page.getByRole('button',{name:'Produkt 2',exact:true}).click()
      await page.getByRole('button',{name:endo,exact:true}).click()
      await expect.poll(async()=>{
        const l=await layout(),axis=l.axis
        const range=(item:{min:number[];max:number[]},maximum:boolean)=>
          axis.reduce((sum:number,v:number,i:number)=>sum+v*((v>=0)===maximum?item.max[i]:item.min[i]),0)
        return Math.round((range(l.items[1],false)-range(l.items[0],true))*1000)
      }).toBe(30)
      const c=await config(),l=await layout()
      expect(l.items[0].sizeMm[0]).toBe(bottle==='Deckel ab'?134:bottle==='Liegend'?210:70)
      expect(l.items[1].min[1]).toBeCloseTo(endo==='Am Handgelenk'?.014:0,5)
      expect(c[0].state).toBe(bottle==='Deckel ab'?'open':bottle==='Liegend'?'lying':'closed')
      expect(l.items.every((i:{sizeMm:number[]})=>i.sizeMm.every(n=>Number.isFinite(n)&&n>0&&n<400))).toBe(true)
    }
  }
  await page.screenshot({path:'.cache/qa/source-products/states.png',fullPage:true})
  expect(errors).toEqual([])
})

test('all colours, all techniques, distinct logos and two instances of the same product',async({page})=>{
  test.slow() // Many material uploads on the software WebGL test renderer.
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?model=endo&second=bottle')
  await page.getByRole('button',{name:'Isolierflasche',exact:true}).click()
  const scene=page.getByTestId('source-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  for(const name of ['Schwarz','Blau','Rot','Weiß','Grün','Orange','Türkis','Mattsilber','Marineblau'])await page.getByRole('button',{name,exact:true}).click()
  await page.getByLabel('Logodatei',{exact:true}).setInputFiles({name:'acme.svg',mimeType:'image/svg+xml',buffer:fixture})
  await expect(page.getByText('acme.svg',{exact:true})).toBeVisible()
  const zones:Record<string,string[]>={front:['laser','pad'],lid:['laser','pad','doming'],roundscreen:['screen'],wrap360:['digital','laser360'],sublimation:['sublimation']}
  for(const [zone,techniques]of Object.entries(zones)) {
    await page.getByLabel('Position',{exact:true}).selectOption(zone)
    for(const tech of techniques)await page.getByLabel('Veredelung',{exact:true}).selectOption(tech)
  }
  await page.getByRole('button',{name:'Produkt 2',exact:true}).click()
  await page.getByRole('button',{name:'Rot',exact:true}).click()
  await page.getByRole('button',{name:'Deckel ab',exact:true}).click()
  const config=await scene.evaluate(e=>JSON.parse(e.getAttribute('data-config')!))
  expect(config[0].color).toBe('navy');expect(config[1].color).toBe('red')
  expect(config[0].state).toBe('closed');expect(config[1].state).toBe('open')
  await expect(page.getByText('acme.svg',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Produkt 1',exact:true}).click()
  await expect(page.getByText('acme.svg',{exact:true})).toBeVisible()
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'PNG herunterladen',exact:true}).click()
  expect((await downloadPromise).suggestedFilename()).toBe('scene-bottle-closed__bottle-open.png')
  await page.screenshot({path:'.cache/qa/source-products/two-bottles.png',fullPage:true})
  expect(errors).toEqual([])
})

test('curved pillow embroidery, transfers and Endo colour variants',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?model=pillow&second=endo')
  const scene=page.getByTestId('source-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await page.getByLabel('Logodatei',{exact:true}).setInputFiles({name:'acme.svg',mimeType:'image/svg+xml',buffer:fixture})
  await expect(page.getByText('acme.svg',{exact:true})).toBeVisible()
  await expect(page.getByLabel('Veredelung',{exact:true})).toHaveValue('embroidery')
  const canvas=scene.locator('canvas')
  const before=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())
  await page.getByLabel('Ohne Veredelung',{exact:true}).check()
  await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(before)
  await page.getByLabel('Ohne Veredelung',{exact:true}).uncheck()
  for(const technique of ['transfer','reflective','screen-transfer','embroidery'])await page.getByLabel('Veredelung',{exact:true}).selectOption(technique)
  await page.screenshot({path:'.cache/qa/source-products/pillow-embroidery.png',fullPage:true})
  await page.getByRole('button',{name:'Produkt 2',exact:true}).click()
  for(const name of ['Grau','Navyblau','Schwarz'])await page.getByRole('button',{name,exact:true}).click()
  await page.getByLabel('Position',{exact:true}).selectOption('pad-front')
  await page.getByRole('group',{name:'Druckfarben',exact:true}).getByRole('button',{name:'4',exact:true}).click()
  await page.getByRole('button',{name:'Box geöffnet',exact:true}).click()
  await page.screenshot({path:'.cache/qa/source-products/pillow-open-box.png',fullPage:true})
  expect(errors).toEqual([])
})

test('mobile composition, language, removing and restoring second slot',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewportSize({width:390,height:844})
  await page.goto('/?model=endo&second=endo')
  await page.getByRole('button',{name:'Isolierflasche',exact:true}).click()
  const scene=page.getByTestId('source-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await page.getByRole('button',{name:'English',exact:true}).click()
  await page.getByRole('button',{name:'Remove second product',exact:true}).click()
  await expect(page.getByRole('button',{name:'Product 2',exact:true})).toHaveCount(0)
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await page.getByRole('button',{name:'Add second product',exact:true}).click()
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await expect(page.getByRole('button',{name:'Product 2',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({path:'.cache/qa/source-products/mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Mug',exact:true}).click()
  await expect(page.getByTestId('scene')).toHaveAttribute('data-model-ready','true')
  await page.getByRole('button',{name:'Insulated bottle',exact:true}).click()
  await expect(page.getByTestId('bottle-scene')).toHaveAttribute('data-model-ready','true')
  expect(errors).toEqual([])
})

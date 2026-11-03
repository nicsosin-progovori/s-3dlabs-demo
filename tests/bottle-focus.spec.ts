import {test,expect as baseExpect} from '@playwright/test'

test.use({reducedMotion:'reduce'})
test.setTimeout(180_000)
const expect=baseExpect.configure({timeout:20_000})

test('single bottle, three states, state-specific camera buttons and all nine colours',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?model=bottle&second=bottle')
  const scene=page.getByTestId('bottle-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  expect(new URL(page.url()).searchParams.has('second')).toBe(false)
  await page.getByRole('button',{name:'English',exact:true}).click()
  await expect(page.getByRole('button',{name:'Product 2',exact:true})).toHaveCount(0)
  for(const {name,id,views}of [
    {name:'Standing',id:'closed',views:['Hero','Body','Three-quarter','Logo']},
    {name:'Lid removed',id:'open',views:['Hero','Body','Top','Logo']},
    {name:'Lying down',id:'lying',views:['Hero','Three-quarter','Top','Logo']},
  ]){
    await page.getByRole('group',{name:'State',exact:true}).getByRole('button',{name,exact:true}).click()
    await expect(scene).toHaveAttribute('data-state',id)
    await expect(page.getByRole('group',{name:'Views',exact:true}).getByRole('button')).toHaveText(views)
    for(const view of views){
      await page.getByRole('group',{name:'Views',exact:true}).getByRole('button',{name:view,exact:true}).click()
      await expect.poll(()=>scene.evaluate(e=>{
        const c=JSON.parse(e.getAttribute('data-camera')??'null')
        return c&&!c.moving&&c.request===Number(e.getAttribute('data-camera-request'))&&c.projected.length===8&&c.projected.every((p:number[])=>Math.abs(p[0])<1&&Math.abs(p[1])<1&&p[2]>-1&&p[2]<1)
      })).toBe(true)
    }
  }
  for(const name of ['Black','Blue','Red','White','Green','Orange','Turquoise','Matt silver','Navy'])await page.getByRole('group',{name:'Colour',exact:true}).getByRole('button',{name,exact:true}).click()
  await expect(scene).toHaveAttribute('data-color','navy')
  expect(errors).toEqual([])
})

test('location and technique are separate, methods preserve the camera and PNG uses the current settings',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/?model=bottle')
  await page.getByRole('button',{name:'English',exact:true}).click()
  const scene=page.getByTestId('bottle-scene')
  await expect(scene).toHaveAttribute('data-model-ready','true')
  await page.getByRole('group',{name:'Views',exact:true}).getByRole('button',{name:'Logo',exact:true}).click()
  await expect.poll(()=>scene.evaluate(e=>{
    const c=JSON.parse(e.getAttribute('data-camera')??'null')
    return c&&!c.moving&&c.request===Number(e.getAttribute('data-camera-request'))
  })).toBe(true)
  const position=await scene.evaluate(e=>JSON.parse(e.getAttribute('data-camera')!).position)
  for(const method of ['laser','pad','screen','digital','laser360','sublimation']){
    await page.getByLabel('Method',{exact:true}).selectOption(method)
    await expect(scene).toHaveAttribute('data-method',method)
    expect(await scene.evaluate(e=>JSON.parse(e.getAttribute('data-camera')!).position)).toEqual(position)
  }
  await page.getByRole('group',{name:'Placement',exact:true}).getByRole('button',{name:'Bamboo lid',exact:true}).click()
  for(const method of ['laser','pad','doming'])await page.getByLabel('Method',{exact:true}).selectOption(method)
  await expect(scene).toHaveAttribute('data-method','doming')
  await page.getByLabel('Method',{exact:true}).selectOption('none')
  await expect(scene).toHaveAttribute('data-method','none')
  await page.getByLabel('Method',{exact:true}).selectOption('doming')
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'Download PNG',exact:true}).click()
  expect((await download).suggestedFilename()).toBe('bottle-closed-branding-doming.png')
  expect(errors).toEqual([])
})

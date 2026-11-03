import {test,expect} from '@playwright/test'

test.describe('continuous bottle animation',()=>{
  test.use({reducedMotion:'no-preference'})
  test('six directed transitions render intermediate poses, keep floor contact and preserve decoration',async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto('/?model=bottle')
    const scene=page.getByTestId('bottle-scene')
    await expect(scene).toHaveAttribute('data-model-ready','true')
    await page.getByRole('button',{name:'English',exact:true}).click()
    await page.getByRole('button',{name:'Blue',exact:true}).click()
    await page.getByRole('button',{name:'Bamboo lid',exact:true}).click()
    await page.getByLabel('Method',{exact:true}).selectOption('doming')
    for(const [label,id]of [['Lid removed','open'],['Standing','closed'],['Lying down','lying'],['Lid removed','open'],['Lying down','lying'],['Standing','closed']]){
      await page.getByRole('group',{name:'State',exact:true}).getByRole('button',{name:label,exact:true}).click()
      await expect(scene).toHaveAttribute('data-transitioning','true')
      await expect(page.getByRole('group',{name:'Views',exact:true}).getByRole('button').first()).toBeDisabled()
      const samples=await scene.evaluate(element=>new Promise<{progress:number;body:number;lid:number;duration:number;action:number;framing:number;frames:number}[]>(resolve=>{
        const result:{progress:number;body:number;lid:number;duration:number;action:number;framing:number;frames:number}[]=[]
        const read=()=>{
          const motion=JSON.parse(element.getAttribute('data-motion')!)
          result.push({progress:motion.progress,body:motion.bodyFloorMm,lid:motion.lidFloorMm,duration:motion.durationMs,action:motion.actionDurationMs,framing:motion.framingDurationMs,frames:motion.frames})
          if(!motion.active)resolve(result)
          else requestAnimationFrame(read)
        };read()
      }))
      expect(samples.some(s=>s.progress>0&&s.progress<1)).toBe(true)
      expect(samples.every(s=>s.body>=-.001&&s.body<.001&&s.lid>=-.001)).toBe(true)
      expect(samples.at(-1)!.frames).toBeGreaterThan(1)
      const last=samples.at(-1)!
      expect(last.action).toBeGreaterThan(0)
      expect(last.action).toBeLessThanOrEqual(1800)
      expect(last.framing).toBeGreaterThanOrEqual(0)
      expect(last.framing).toBeLessThanOrEqual(850)
      expect(Math.abs(last.duration-last.action-last.framing)).toBeLessThanOrEqual(1)
      await expect(scene).toHaveAttribute('data-state',id)
      await expect(scene).toHaveAttribute('data-transitioning','false')
      await expect(scene).toHaveAttribute('data-color','blue')
      await expect(scene).toHaveAttribute('data-method','doming')
      await expect(page.getByRole('group',{name:'State',exact:true}).getByRole('button').first()).toBeEnabled()
    }
    expect(errors).toEqual([])
  })
})

test.describe('reduced motion bottle',()=>{
  test.use({reducedMotion:'reduce'})
  test('state controls reach the same poses without animation or a stuck interaction lock',async({page})=>{
    await page.goto('/?model=bottle')
    await page.getByRole('button',{name:'English',exact:true}).click()
    const scene=page.getByTestId('bottle-scene')
    await expect(scene).toHaveAttribute('data-model-ready','true')
    for(const [label,id]of [['Lid removed','open'],['Lying down','lying'],['Standing','closed']]){
      await page.getByRole('group',{name:'State',exact:true}).getByRole('button',{name:label,exact:true}).click()
      await expect(scene).toHaveAttribute('data-transitioning','false')
      await expect(scene).toHaveAttribute('data-state',id)
      const motion=await scene.evaluate(e=>JSON.parse(e.getAttribute('data-motion')!))
      expect(motion.progress).toBe(1);expect(motion.durationMs).toBe(0)
      expect(motion.bodyFloorMm).toBeCloseTo(0,5)
    }
  })
})

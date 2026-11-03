import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {logoCameraAudit} from './logo-camera-audit.mjs'
import {readGlbGeometry} from './read-glb-geometry.mjs'
import {createPillowSubject,pillowCameraPlan} from '../src/pillowViews.ts'
import {studioCameraFrame,studioCameraMove} from '../src/studioCameraMotion.ts'

const cases=await logoCameraAudit(),subject=createPillowSubject(await readGlbGeometry(new URL('../public/models/pillow/pillow-v02.glb',import.meta.url)))
const frame=r=>({...r.camera,position:new Vector3(...r.camera.position),target:new Vector3(...r.camera.target)})
// Bottle placement changes are also camera moves, so body and cap share a group.
const groups=Map.groupBy(cases,r=>[r.product,r.state,...r.viewport].join('/'))
const plan=(a,b,previous,elapsed)=>a.product==='pillow'?pillowCameraPlan(frame(a),frame(b),subject,...a.viewport,previous?{move:previous}:undefined,elapsed).move:studioCameraMove(frame(a),frame(b),{previous,elapsed})
const components=f=>[...f.position.toArray(),...f.target.toArray(),f.fov,f.roll]
const distance=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])))
const velocity=(move,t,h)=>{
  const a=components(studioCameraFrame(move,t-h/move.duration)),b=components(studioCameraFrame(move,t+h/move.duration))
  return b.map((v,i)=>(v-a[i])/(2*h))
}

test('all camera routes, including bottle placement switches, are finite, grounded and arrive exactly',()=>{
  let routes=0
  for(const shots of groups.values())for(const a of shots)for(const b of shots){
    if(a===b)continue
    const move=plan(a,b);assert.ok(move.duration>=.66&&move.duration<1.5);routes++
    for(let i=0;i<=120;i++){
      const f=studioCameraFrame(move,i/120)
      assert.ok(components(f).every(Number.isFinite))
      assert.ok(f.position.y>=.06,`${a.product}/${a.state}: ${a.surface}/${a.view} -> ${b.surface}/${b.view} crosses floor`)
      assert.ok(f.position.distanceTo(f.target)>.025)
    }
    assert.ok(distance(components(studioCameraFrame(move,0)),components(frame(a)))<1e-8)
    assert.ok(distance(components(studioCameraFrame(move,1)),components(frame(b)))<1e-8)
  }
  assert.equal(routes,384)
})

test('repeated selection of a settled view has no pullback or artificial camera animation',()=>{
  for(const a of cases){const move=plan(a,a);assert.equal(move.duration,0);assert.ok(distance(components(studioCameraFrame(move,.5)),components(frame(a)))<1e-8)}
})

test('rapid retargeting preserves position, velocity and acceleration instead of restarting the ease',()=>{
  for(const shots of groups.values())for(const a of shots)for(const b of shots.filter(b=>b!==a))for(const t of [.18,.46,.74]){
    const before=plan(a,b),at=studioCameraFrame(before,t),next=studioCameraMove(at,frame(a),{previous:before,elapsed:t*before.duration})
    assert.ok(distance(components(at),components(studioCameraFrame(next,0)))<1e-8)
    const h=.00001,oldVelocity=velocity(before,t,h),initial=components(at),n1=components(studioCameraFrame(next,h/next.duration)),n2=components(studioCameraFrame(next,2*h/next.duration))
    const nextVelocity=n1.map((v,i)=>(-3*initial[i]+4*v-n2[i])/(2*h))
    assert.ok(distance(oldVelocity,nextVelocity)<.002,'No velocity jump when the next button is pressed')
    const oldBefore=components(studioCameraFrame(before,t-h/before.duration)),oldAfter=components(studioCameraFrame(before,t+h/before.duration))
    const oldAcceleration=oldBefore.map((v,i)=>(v-2*initial[i]+oldAfter[i])/(h*h)),nextAcceleration=n2.map((v,i)=>(v-2*n1[i]+initial[i])/(h*h))
    assert.ok(distance(oldAcceleration,nextAcceleration)<.35,'No abrupt braking at retarget')
  }
})

test('pillow pullback and orbit no longer contain forced intermediate stops',()=>{
  for(const shots of groups.values())if(shots[0].product==='pillow')for(const a of shots)for(const b of shots.filter(b=>b!==a)){
    const move=plan(a,b)
    for(const t of [.30,.70])assert.ok(Math.hypot(...velocity(move,t,.0001))>.1,`${a.view} -> ${b.view}: mid-move stop`)
  }
})

test('interrupted routes stay above the floor and outside the pillow',()=>{
  const body=subject.body.clone();body.min.multiplyScalar(12.5);body.max.multiplyScalar(12.5)
  for(const shots of groups.values())for(const a of shots)for(const b of shots.filter(b=>b!==a))for(const t of [.18,.46,.74]){
    const first=plan(a,b),at=studioCameraFrame(first,t)
    const next=a.product==='pillow'?pillowCameraPlan(at,frame(a),subject,...a.viewport,{move:first},t*first.duration).move:studioCameraMove(at,frame(a),{previous:first,elapsed:t*first.duration})
    for(let i=0;i<=120;i++){
      const f=studioCameraFrame(next,i/120)
      assert.ok(f.position.y>=.06,`${a.product}/${a.state}/${a.view} -> ${b.view} interrupted at ${t}: floor`)
      if(a.product==='pillow')assert.ok(!body.containsPoint(f.position),'Interrupted orbit must stay outside the cushion')
    }
  }
})

test('selecting the frame being passed through brakes smoothly instead of discarding its momentum',()=>{
  for(const shots of groups.values())if(shots.length>1){
    const move=plan(shots[0],shots.at(-1)),at=studioCameraFrame(move,.4),next=studioCameraMove(at,at,{previous:move,elapsed:move.duration*.4})
    assert.ok(next.duration>0);assert.ok(distance(components(studioCameraFrame(next,1)),components(at))<1e-8)
  }
})

test('a burst of seven target changes stays finite and above the floor',()=>{
  for(const shots of groups.values())if(shots.length>1){
    let at=frame(shots[0]),previous
    for(const index of [2,4,1,3,0,2,1]){
      const next=shots[0].product==='pillow'?pillowCameraPlan(at,frame(shots[index%shots.length]),subject,...shots[0].viewport,previous?{move:previous}:undefined,previous?.duration*.18).move:studioCameraMove(at,frame(shots[index%shots.length]),{previous,elapsed:previous?.duration*.18})
      for(let i=0;i<=120;i++){const f=studioCameraFrame(next,i/120);assert.ok(components(f).every(Number.isFinite));assert.ok(f.position.y>=.06)}
      previous=next;at=studioCameraFrame(next,.18)
    }
  }
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {logoCameraAudit} from './logo-camera-audit.mjs'

const cases=await logoCameraAudit()
for(const product of ['bottle','endo','pillow'])test(`${product}: every customer camera keeps the real logo visible, in frame and facing the viewer`,()=>{
  const shots=cases.filter(r=>r.product===product&&r.state!=='box-closed')
  assert.ok(shots.length>0)
  for(const r of shots){
    const label=`${r.product} / ${r.state} / ${r.surface} / ${r.view} @ ${r.viewport[0]}px`
    const centre=r.samples.find(s=>s.u===0&&s.v===0)
    assert.ok(centre.visible,`${label}: logo centre hidden by ${centre.occluder??'framing'}`)
    assert.ok(r.visible>=.95,`${label}: only ${r.visible*100}% of the logo rectangle is visible`)
    assert.ok(r.facing>.35,`${label}: logo faces away or is flattened to a sliver (${r.facing})`)
    assert.ok(r.widthPx>=6&&r.heightPx>=2.5,`${label}: the physical logo disappears at this scale (${r.widthPx} x ${r.heightPx}px)`)
  }
})

test('closed Endo packaging is the sole explicit exception',()=>{
  const exceptions=cases.filter(r=>r.state==='box-closed')
  assert.equal(exceptions.length,2)
  assert.ok(exceptions.every(r=>r.view==='overview'&&r.visible===0),'One technical packaging view; do not fabricate printing on the box')
})

test('adjacent buttons, including the return to Hero, visibly change magnification or composition',()=>{
  const groups=Map.groupBy(cases,r=>[r.product,r.state,r.surface,...r.viewport].join('/'))
  const difference=(a,b)=>{
    const size=r=>Math.sqrt(r.widthPx*r.heightPx),ratio=Math.max(size(a),size(b))/Math.min(size(a),size(b))
    const direction=r=>new Vector3().fromArray(r.camera.position).sub(new Vector3().fromArray(r.camera.target)).normalize()
    return {ratio,angle:direction(a).angleTo(direction(b))*180/Math.PI,roll:Math.abs(a.camera.roll-b.camera.roll)}
  }
  for(const [label,shots]of groups){
    if(shots.length<2)continue
    for(let i=0;i<shots.length;i++){
      const a=shots[i],b=shots[(i+1)%shots.length],{ratio,angle,roll}=difference(a,b)
      assert.ok(ratio>=1.30||angle>=40||roll>=25,`${label}: ${a.view} -> ${b.view} is too similar (${ratio.toFixed(2)}x, ${angle.toFixed(1)} degrees, roll ${roll})`)
      for(const other of shots.slice(i+1)){
        const d=difference(a,other)
        assert.ok(d.ratio>=1.25||d.angle>=30||d.roll>=20,`${label}: ${a.view} and ${other.view} duplicate each other`)
      }
    }
  }
})

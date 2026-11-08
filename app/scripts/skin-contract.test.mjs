import {test} from 'node:test'
import assert from 'node:assert/strict'
import {skinSurface,validateSkinManifest,validateGeometrySkinSurface,sameCompatibility,parseSkinKey} from '../src/player/materials/skinContract.ts'

// Issue #1: скин сверяется с ОБЪЕКТОМ, а не с бутылкой. Здесь — объект, которого нет в старом реестре.
const surface=skinSurface({skin:{compatibility:{modelId:'endo',uvLayout:'endo-uv-v01'},slots:['strap','frame'],default:'endo-black@v01',dir:'skins'}})
const profile={images:[],textures:[],samplers:[]}
const skin=(extra={})=>({schemaVersion:1,id:'endo-black',revision:'v01',compatibility:{modelId:'endo',uvLayout:'endo-uv-v01'},
  materials:[{name:'Strap',extras:{materialSlotId:'strap'}},{name:'Frame',extras:{materialSlotId:'frame'}}],profiles:{low:profile,final:profile},...extra})
const ref={id:'endo-black',revision:'v01'}

test('any object with any number of slots — no bottle registry, no "exactly 7"',()=>{
  assert.doesNotThrow(()=>validateSkinManifest(skin(),ref,surface))
})
test('compatibility must match the object entirely',()=>{
  assert.throws(()=>validateSkinManifest(skin({compatibility:{modelId:'bottle',uvLayout:'endo-uv-v01'}}),ref,surface),/not compatible/)
  assert.throws(()=>validateSkinManifest(skin({compatibility:{modelId:'endo'}}),ref,surface),/not compatible/)
  assert.equal(sameCompatibility({a:'1',b:'2'},{b:'2',a:'1'}),true)
})
test('slots: only the object ones, all of them, no duplicates',()=>{
  const s=skin();s.materials.push({name:'Lid',extras:{materialSlotId:'lid'}})
  assert.throws(()=>validateSkinManifest(s,ref,surface),/not declared by the object/)
  const t=skin();t.materials.pop()
  assert.throws(()=>validateSkinManifest(t,ref,surface),/does not cover slots frame/)
  const u=skin();u.materials[1].extras.materialSlotId='strap'
  assert.throws(()=>validateSkinManifest(u,ref,surface),/duplicate/)
})
test('identity and geometry declaration are strict',()=>{
  assert.throws(()=>validateSkinManifest(skin(),{id:'endo-grey',revision:'v01'},surface),/identity/)
  assert.doesNotThrow(()=>validateGeometrySkinSurface(undefined,surface))
  assert.throws(()=>validateGeometrySkinSurface({modelId:'bottle'},surface),/does not match/)
  assert.throws(()=>parseSkinKey('endo-black'),/Invalid skin key/)
})
test('object surface itself is validated',()=>{
  assert.equal(skinSurface({}),null)
  assert.throws(()=>skinSurface({skin:{compatibility:{},slots:['a'],default:'a@v01',dir:'skins'}}),/compatibility/)
  assert.throws(()=>skinSurface({skin:{compatibility:{m:'x'},slots:['a','a'],default:'a@v01',dir:'skins'}}),/slots/)
  assert.throws(()=>skinSurface({skin:{compatibility:{m:'x'},slots:['a'],default:'a@v01',dir:'../x'}}),/dir/)
})

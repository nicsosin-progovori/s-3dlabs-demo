import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,readdirSync} from 'node:fs'
import {shadowDeclaration,resolveShadowParams,validateShadowDescriptor} from '../src/player/sockets/shadowSocket.ts'
import {skinSurface,skinFile,parseSkinKey,validateSkinManifest} from '../src/player/materials/skinContract.ts'
import {sceneDeclaration,objectToMetres,validateSceneProfile} from '../src/player/scenes/sceneContract.ts'
import {checkShadowNeeds} from '../src/player/sockets/shadowSocket.ts'

// Контракты данных (app/contracts/*.schema.json) ↔ реальные файлы проекта.
// Валидатор JSON Schema пока не подключён: проверяем строгими проверками плеера
// плюс сверяем, что обязательные поля схемы есть в данных.
const root=new URL('../../',import.meta.url),contracts=new URL('../contracts/',import.meta.url)
const json=url=>JSON.parse(readFileSync(url))

test('every contract schema is well-formed',()=>{
  for(const name of readdirSync(contracts).filter(n=>n.endsWith('.schema.json'))){
    const schema=json(new URL(name,contracts))
    assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema',name)
    assert.equal(schema.$id,name,name)
    assert.ok(schema.title&&schema.description,name)
  }
})

test('every shadow package follows shadow.schema.json and the player contract',()=>{
  const schema=json(new URL('shadow.schema.json',contracts))
  for(const id of readdirSync(new URL('shadows/',root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))
    for(const rev of readdirSync(new URL(`shadows/${id}/`,root))){
      const file=new URL(`shadows/${id}/${rev}/shadow.json`,root),d=json(file)
      assert.ok(existsSync(new URL(d.$schema,file)),`${id}@${rev}: $schema must point to the contract`)
      for(const key of schema.required)assert.ok(key in d,`${id}@${rev}: missing ${key}`)
      for(const key of Object.keys(d))assert.ok(key in schema.properties,`${id}@${rev}: ${key} is not in the contract`)
      validateShadowDescriptor(d,id,rev)
      resolveShadowParams(d.params)
    }
})

test('every object declares its shadow and the params fit the chosen shadow',()=>{
  for(const id of readdirSync(new URL('objects/',root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))
    for(const rev of readdirSync(new URL(`objects/${id}/`,root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)){
      const manifest=json(new URL(`objects/${id}/${rev}/manifest.json`,root))
      const decl=shadowDeclaration(manifest.render)
      if(!decl)continue
      const [sid,srev]=decl.use.split('@')
      resolveShadowParams(json(new URL(`shadows/${sid}/${srev}/shadow.json`,root)).params,decl.params)
    }
})

test('every object declares its skin surface; every packaged skin fits the object and skin.schema.json',()=>{
  const schema=json(new URL('skin.schema.json',contracts))
  for(const id of readdirSync(new URL('objects/',root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))
    for(const rev of readdirSync(new URL(`objects/${id}/`,root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)){
      const base=new URL(`objects/${id}/${rev}/`,root),manifest=json(new URL('manifest.json',base))
      const surface=skinSurface(manifest.render)
      const skins=manifest.parts.skins??[]
      if(!surface){assert.equal(skins.length,0,`${id}@${rev}: skins without render.skin`);continue}
      const files=skins.map(p=>p.file)
      assert.ok(files.includes(skinFile(surface,parseSkinKey(surface.default))),`${id}@${rev}: default skin is not packaged`)
      for(const part of skins){
        const m=new RegExp(`^${surface.dir}/([^/]+)/([^/]+)/skin\\.json$`).exec(part.file)
        assert.ok(m,`${part.file}: not under render.skin.dir`)
        const file=new URL(part.file,base),d=json(file)
        assert.ok(existsSync(new URL(d.$schema,file)),`${part.file}: $schema must point to the contract`)
        for(const key of schema.required)assert.ok(key in d,`${part.file}: missing ${key}`)
        for(const key of Object.keys(d))assert.ok(key in schema.properties,`${part.file}: ${key} is not in the contract`)
        validateSkinManifest(d,{id:m[1],revision:m[2]},surface)
      }
    }
})

test('every scene package follows scene.schema.json and the player contract',()=>{
  const schema=json(new URL('scene.schema.json',contracts))
  for(const id of readdirSync(new URL('scenes/',root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))
    for(const rev of readdirSync(new URL(`scenes/${id}/`,root))){
      const file=new URL(`scenes/${id}/${rev}/scene.json`,root),d=json(file)
      assert.ok(existsSync(new URL(d.$schema,file)),`${id}@${rev}: $schema must point to the contract`)
      for(const key of schema.required)assert.ok(key in d,`${id}@${rev}: missing ${key}`)
      for(const key of Object.keys(d))assert.ok(key in schema.properties,`${id}@${rev}: ${key} is not in the contract`)
      for(const key of Object.keys(d.settings))assert.ok(key in schema.properties.settings.properties,`${id}@${rev}: settings.${key} is not in the contract`)
      validateSceneProfile(d,{id,revision:rev})
    }
})

test('every object names existing scenes, brings its units, and its shadow fits every chosen scene',()=>{
  for(const id of readdirSync(new URL('objects/',root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))
    for(const rev of readdirSync(new URL(`objects/${id}/`,root),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name)){
      const manifest=json(new URL(`objects/${id}/${rev}/manifest.json`,root))
      assert.ok(!('scene' in manifest.render),`${id}@${rev}: render.scene is replaced by render.scenes`)
      assert.ok(!('scene' in manifest.parts),`${id}@${rev}: scenes are not part of the object package`)
      objectToMetres(manifest.render)
      const decl=shadowDeclaration(manifest.render)
      const shadow=decl&&json(new URL(`shadows/${decl.use.replace('@','/')}/shadow.json`,root))
      for(const key of sceneDeclaration(manifest.render)){
        const [sid,srev]=key.split('@'),file=new URL(`scenes/${sid}/${srev}/scene.json`,root)
        assert.ok(existsSync(file),`${id}@${rev}: scene ${key} does not exist`)
        const scene=validateSceneProfile(json(file),{id:sid,revision:srev})
        if(shadow)checkShadowNeeds(shadow,scene.settings)
      }
    }
})

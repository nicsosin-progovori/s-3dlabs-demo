import test from 'node:test'
import assert from 'node:assert/strict'
import {apiUrl} from '../src/apiUrl.ts'

test('API URLs preserve the application prefix by default, including the internal render worker',()=>{
  assert.equal(apiUrl('scenes/default','https://pages.invalid/demo/bottle.html','').href,'https://pages.invalid/demo/api/scenes/default')
  assert.equal(apiUrl('logos/abc.png','http://127.0.0.1:5181/render.html','').href,'http://127.0.0.1:5181/api/logos/abc.png')
})
test('an explicit public API origin changes API requests independently of static assets',()=>{
  assert.equal(apiUrl('camera-views/bottle','https://pages.invalid/demo/bottle.html','https://backend.invalid').href,'https://backend.invalid/api/camera-views/bottle')
  assert.equal(apiUrl('render','https://pages.invalid/demo/bottle.html','http://127.0.0.1:5181').href,'http://127.0.0.1:5181/api/render')
})
test('API configuration rejects credentials, insecure remote hosts, paths and route traversal',()=>{
  for(const origin of ['http://backend.invalid','https://user:secret@backend.invalid','https://backend.invalid/prefix','https://backend.invalid/?token=x','https://backend.invalid/#x','javascript:alert(1)'])assert.throws(()=>apiUrl('render','https://pages.invalid/bottle.html',origin))
  for(const route of ['../render','logos/../render','https://other.invalid/api/render','/render','render?url=x'])assert.throws(()=>apiUrl(route,'https://pages.invalid/bottle.html',''))
})

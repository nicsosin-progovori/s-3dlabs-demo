import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { probePreview, publicStatus } from './share-health.mjs'

test('a live tunnel process with an empty HTTP 502 is unavailable', async () => {
  const server = createServer((_request, response) => response.writeHead(502).end())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const health = await probePreview(`http://127.0.0.1:${server.address().port}`)
    assert.equal(health.httpStatus, 502)
    assert.equal(health.available, false)
    assert.equal(publicStatus({ status: 'running' }, true, health).status, 'unavailable')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('only the application HTML counts as a healthy endpoint', async () => {
  let body = '<title>S. 3DLABS</title><div id="root"></div><script type="module" src="/assets/app.js"></script>'
  const server = createServer((_request, response) => response.writeHead(200).end(body))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(publicStatus({}, true, await probePreview(url)).status, 'running')
    body = '<html>Provider warning</html>'
    assert.equal(publicStatus({}, true, await probePreview(url)).status, 'unavailable')
    body = ''
    assert.equal((await probePreview(url)).available, false)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('a dead process never retains a running status', () => {
  assert.equal(publicStatus({ status: 'running' }, false, null).status, 'offline')
  assert.equal(publicStatus({ status: 'failed' }, false, null).status, 'failed')
  assert.equal(publicStatus(null, false, null).available, false)
})

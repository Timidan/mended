import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { createApp } from './server.mjs'
import { createStore } from './db.mjs'

function request(app, path, body, authorization) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: { authorization }, socket: { remoteAddress: 'local' } })
    const res = { status: 200, headers: {}, setHeader(name, value) { this.headers[name] = value },
      writeHead(status, headers) {
        this.status = status
        Object.assign(this.headers, headers)
        return this
      },
      end(body = '') { resolve({ status: this.status, headers: this.headers, text: String(body) }) } }
    app.emit('request', req, res)
  })
}

test('private page and API require the token and disappear when unset', async () => {
  const store = createStore(':memory:')
  try {
    const hidden = createApp({ store, adminToken: '' })
    assert.equal((await request(hidden, '/answer.html')).status, 404)
    assert.equal((await request(hidden, '/api/answer', {})).status, 404)
    const app = createApp({ store, adminToken: 'test-token' })
    assert.equal((await request(app, '/answer')).status, 401)
    assert.equal((await request(app, '/api/answer', {}, 'Bearer wrong-token')).status, 401)
    assert.equal((await request(app, '/answer.html', undefined, `Basic ${Buffer.from('admin:test-token').toString('base64')}`)).status, 200)
    assert.deepEqual(JSON.parse((await request(app, '/api/answer', undefined, 'Bearer test-token')).text), { questions: [] })
  } finally {
    store.close()
  }
})

test('a person answers once and reports never add verifications', async () => {
  const store = createStore(':memory:')
  try {
    const q = store.addQuestion({ error: '401', answered_from: 'none', state: 'handed_off' })
    let writes = 0
    const memories = { connected: true, remember: async () => {
      writes += 1
      if (writes === 1) throw new Error('offline')
      return 'memory-one'
    } }
    const app = createApp({ store, memories, adminToken: 'test-token' })
    const body = { questionId: q.id, title: 'Register key', body: 'Register it. token=secret123' }
    const response = await request(app, '/api/answer', body, 'Bearer test-token')
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.text, /secret123/)
    assert.match(JSON.parse(response.text).memoryError, /Answer saved/)
    const queue = JSON.parse((await request(app, '/api/answer', undefined, 'Bearer test-token')).text).questions
    assert.equal(queue[0].fix.body, 'Register it. [secret]')
    await request(app, '/api/answer', body, 'Bearer test-token')
    await request(app, '/api/answer', body, 'Bearer test-token')
    assert.equal(writes, 2)
    assert.equal(store.pending().length, 0)
    await request(app, '/api/report', { questionId: q.id })
    await request(app, '/api/report', { questionId: q.id })
    const { fixes } = JSON.parse((await request(app, '/api/fixes')).text)
    assert.equal(fixes.length, 1)
    assert.equal(fixes[0].reported, 1)
    assert.equal(fixes[0].verified, 0)
  } finally {
    store.close()
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { createApp } from './server.mjs'
import { createStore } from './db.mjs'

function request(app, path, body, authorization, headers = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: { authorization, 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost', ...headers }, socket: { remoteAddress: 'local' } })
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
      return { id: 'memory-one', blob_id: 'blob-one', blob_object_id: 'object-one' }
    } }
    const app = createApp({ store, memories, adminToken: 'test-token' })
    const body = { questionId: q.id, error: 'Redacted error', title: 'Register key', body: 'Register it. token=secret123' }
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
    assert.equal(fixes[0].error, undefined)
    assert.equal(store.fix(fixes[0].id).error, 'Redacted error')
  } finally {
    store.close()
  }
})


test('JSON, same-host answer origin, health and security headers are enforced', async () => {
  const store = createStore(':memory:')
  try {
    const app = createApp({ store, adminToken: 'token' })
    assert.equal((await request(app, '/api/ask', {}, undefined, { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await request(app, '/api/answer', {}, 'Bearer token', { origin: 'https://elsewhere.test' })).status, 403)
    assert.equal((await request(app, '/api/answer', {}, 'Bearer token', { origin: undefined })).status, 403)
    const health = await request(app, '/healthz')
    assert.equal(health.status, 200)
    assert.equal(health.headers['x-content-type-options'], 'nosniff')
    assert.equal(health.headers['referrer-policy'], 'no-referrer')
    assert.match(health.headers['content-security-policy'], /fonts.googleapis.com/)
    const q = store.addQuestion({ error: 'old error', state: 'handed_off', answered_from: 'none' })
    assert.equal((await request(app, '/api/answer', { questionId: q.id, action: 'dismiss' }, 'Bearer token')).status, 200)
    assert.equal(store.pending().length, 0)
  } finally { store.close() }
})

test('failed logins are limited by last forwarded IP unless Cloudflare is trusted, and stale entries expire', async () => {
  const store = createStore(':memory:')
  try {
    let now = 0
    const app = createApp({ store, adminToken: 'token', trustCloudflare: false, now: () => now })
    for (let i = 0; i < 20; i++) {
      assert.equal((await request(app, '/answer', undefined, undefined, { 'x-forwarded-for': `${i}, caller`, 'cf-connecting-ip': `forged-${i}` })).status, 401)
    }
    assert.equal((await request(app, '/answer', undefined, undefined, { 'x-forwarded-for': 'caller' })).status, 429)
    now = 60000
    assert.equal((await request(app, '/answer', undefined, undefined, { 'x-forwarded-for': 'caller' })).status, 401)
    const trusted = createApp({ store, adminToken: 'token', trustCloudflare: true })
    for (let i = 0; i < 21; i++) {
      assert.equal((await request(trusted, '/answer', undefined, undefined, { 'cf-connecting-ip': `caller-${i}` })).status, 401)
    }
  } finally { store.close() }
})

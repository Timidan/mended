import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMemory, MAX_DISTANCE } from './memory.mjs'

test('recall maps bounded hits and writes are scrubbed, completed and paced', async () => {
  let time = 0
  const writes = []
  const client = {
    recall: async (options) => {
      assert.equal(options.namespace, 'fixes')
      assert.equal(options.maxDistance, MAX_DISTANCE)
      assert.doesNotMatch(options.query, /secret123/)
      return { results: [{ text: '[fix:one]\nFix', distance: 0.1 }, { text: '[fix:far]', distance: MAX_DISTANCE }] }
    },
    rememberAndWait: async (text, namespace, options) => {
      writes.push(time)
      assert.match(text, /^\[fix:one\]/)
      assert.doesNotMatch(text, /secret123/)
      assert.equal(namespace, 'fixes')
      assert.equal(options.dedupe, true)
      return { id: 'memory-one', blob_id: 'blob-one' }
    },
  }
  const memory = createMemory({ accountId: 'account', client, now: () => time, sleep: async (ms) => { time += ms } })
  assert.deepEqual(await memory.recall('401 token=secret123'), [{ id: 'one', distance: 0.1 }])
  const fix = { id: 'one', title: '401', error: 'token=secret123', body: 'Register key' }
  assert.deepEqual(await Promise.all([memory.remember(fix), memory.remember(fix)]), ['memory-one', 'memory-one'])
  assert.deepEqual(writes, [0, 11000])
})

test('missing account makes all memory operations no-ops', async () => {
  const memory = createMemory({ accountId: '', client: {} })
  assert.equal(memory.connected, false)
  assert.deepEqual(await memory.recall('error'), [])
  assert.equal(await memory.remember({}), null)
})

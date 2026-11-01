import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMemory, createRecallBudget, MAX_DISTANCE } from './memory.mjs'

test('recall maps bounded hits and writes are scrubbed, completed and paced', async () => {
  let time = 0
  const writes = []
  const client = {
    recall: async (options) => {
      assert.equal(options.namespace, 'fixes')
      assert.equal(options.maxDistance, MAX_DISTANCE)
      assert.doesNotMatch(options.query, /secret123/)
      return { results: [{ text: '[fix:one]\nFix', distance: 0.1, blob_id: 'blob-one' }, { text: '[fix:far]', distance: MAX_DISTANCE }] }
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
  const memory = createMemory({ accountId: 'account', client, listBlobs: async () => [{ objectId: 'object-one', blobId: 'blob-one' }], now: () => time, sleep: async (ms) => { time += ms } })
  assert.deepEqual(await memory.recall('401 token=secret123'), [{ id: 'one', distance: 0.1, blob_id: 'blob-one' }])
  const fix = { id: 'one', title: '401', error: 'token=secret123', body: 'Register key' }
  assert.deepEqual(await Promise.all([memory.remember(fix), memory.remember(fix)]), Array(2).fill({ id: 'memory-one', blob_id: 'blob-one', blob_object_id: 'object-one' }))
  assert.deepEqual(writes, [0, 11000])
})

test('missing account makes all memory operations no-ops', async () => {
  const memory = createMemory({ accountId: '', client: {} })
  assert.equal(memory.connected, false)
  assert.deepEqual(await memory.recall('error'), [])
  assert.equal(await memory.remember({}), null)
})


test('recall caches identical scrubbed text and enforces rolling minute and hour budgets', async () => {
  let time = 0
  let reads = 0
  const budget = createRecallBudget(() => time)
  const client = { recall: async () => { reads += 1; return { results: [] } } }
  const memory = createMemory({ accountId: 'account', client, budget })
  await Promise.all([memory.recall('401 token=secret123'), memory.recall('401 token=secret456')])
  assert.equal(reads, 1)
  for (let i = 1; i < 20; i++) await memory.recall(`error ${i}`)
  await assert.rejects(memory.recall('one more'), /busy/)
  await memory.recall('401 token=secret789')
  assert.equal(reads, 20)
  for (let minute = 1; minute < 20; minute++) {
    time += 60000
    for (let i = 0; i < 20; i++) await memory.recall(`minute ${minute} error ${i}`)
  }
  time += 60000
  await assert.rejects(memory.recall('hour full'), /busy/)
  time = 3600000
  await memory.recall('401 token=secret123')
  assert.equal(reads, 401)
})

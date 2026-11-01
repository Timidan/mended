import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from '../src/db.mjs'
import { seedFixes } from './seed.mjs'

test('seeding resumes missing writes and skips remembered fixes', async () => {
  const store = createStore(':memory:')
  try {
    const rows = [{ title: '401', error: 'token=secret123', fix: 'Register a key', source_url: 'https://example.com/issue/1' }]
    const memories = { connected: true, remember: async (fix) => {
      assert.doesNotMatch(fix.error, /secret123/)
      return { id: 'memory-id', blob_id: 'blob-one', blob_object_id: 'object-one' }
    } }
    await seedFixes(rows, { store, memories: { connected: false, remember: async () => null } })
    assert.equal((await seedFixes(rows, { store, memories })).remembered, 1)
    assert.equal((await seedFixes(rows, { store, memories })).skipped, 1)
    assert.equal(store.fixes().length, 1)
  } finally {
    store.close()
  }
})

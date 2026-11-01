import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from './db.mjs'
import { MEMWAL } from './sui.mjs'
import { watchQuestions } from './watcher.mjs'

test('only a new successful call verifies, once, while expired questions are skipped', async () => {
  const store = createStore(':memory:')
  try {
    const now = Date.parse('2026-11-01T12:00:00Z')
    const fix = store.addFix({ title: 'Fix', error: '401', body: 'Register', source: 'issue', verify_fn: 'add_delegate_key' })
    const fields = { error: '401', owner: 'owner', checkpoint: '100', fix_id: fix.id, answered_from: 'memory', state: 'answered' }
    store.addQuestion({ ...fields, created_at: '2026-11-01T11:00:00Z' })
    store.addQuestion({ ...fields, created_at: '2026-10-24T11:00:00Z' })
    let reads = 0
    const readCalls = async (args) => {
      reads += 1
      assert.equal(args.fn, `${MEMWAL.package}::account::add_delegate_key`)
      assert.equal(args.afterCheckpoint, '100')
      assert.equal(args.untilSuccess, true)
      const tx = { sender: 'owner', checkpoint: '101', timestamp: '2026-11-01T11:01:00Z' }
      return [{ ...tx, ok: false, digest: 'failed' }, { ...tx, ok: true, digest: 'succeeded' }]
    }
    assert.equal((await watchQuestions({ store, readCalls, now })).verified, 1)
    await watchQuestions({ store, readCalls, now })
    assert.equal(reads, 1)
    assert.deepEqual(store.fix(fix.id).digests, ['succeeded'])
  } finally {
    store.close()
  }
})

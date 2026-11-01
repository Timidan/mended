import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from './db.mjs'
import { watchQuestions } from './watcher.mjs'

const now = Date.parse('2026-11-01T12:00:00Z')
const tx = { sender: 'owner', owner: 'owner', checkpoint: '101', timestamp: '2026-11-01T11:01:00Z', ok: true, digest: 'succeeded' }
const add = (store, kind, extra = {}) => {
  const fix = store.addFix({ title: 'Fix', error: '401', body: 'Register', source: 'issue', verify_fn: kind })
  const question = store.addQuestion({ error: '401', owner: 'owner', checkpoint: '100', fix_id: fix.id,
    answered_from: 'memory', state: 'answered', watch_state: 'watching', created_at: '2026-11-01T11:00:00Z', ...extra })
  return { fix, question }
}

test('first failure stops a watch, with grouped reads and expired questions skipped', async () => {
  const store = createStore(':memory:')
  try {
    const { fix, question } = add(store, 'add_delegate_key')
    add(store, 'add_delegate_key', { checkpoint: '99' })
    add(store, 'add_delegate_key', { created_at: '2026-10-24T11:00:00Z' })
    let reads = 0
    const readCalls = async (args) => {
      reads += 1
      assert.equal(args.afterCheckpoint, '99')
      assert.equal(args.first, 1)
      return [{ ...tx, ok: false, digest: 'failed' }, tx]
    }
    assert.equal((await watchQuestions({ store, readCalls, now })).verified, 0)
    await watchQuestions({ store, readCalls, now })
    assert.equal(reads, 1)
    assert.equal(store.question(question.id).watch_state, 'stopped')
    assert.equal(store.fix(fix.id).verified, 0)
  } finally { store.close() }
})

test('add_delegate_key success needs the named key now on the account', async () => {
  const store = createStore(':memory:')
  try {
    const key = 'ab'.repeat(32)
    const { fix } = add(store, 'add_delegate_key', { delegate_key: key })
    const other = add(store, 'add_delegate_key', { delegate_key: 'cd'.repeat(32) })
    let accountReads = 0
    const result = await watchQuestions({ store, now, readCalls: async () => [tx], accountId: async () => 'account', object: async () => {
      accountReads += 1
      return { json: { delegate_keys: [{ public_key: `0x${key.toUpperCase()}` }] } }
    } })
    assert.equal(result.verified, 1)
    assert.equal(accountReads, 1)
    assert.equal(store.fix(fix.id).verified, 1)
    assert.equal(store.question(other.question.id).watch_state, 'stopped')
  } finally { store.close() }
})

test('memory writes need the named delegate and do not skip an earlier mismatching write', async () => {
  const store = createStore(':memory:')
  try {
    const key = 'ab'.repeat(32)
    const good = add(store, 'memory_write', { delegate_key: key })
    const bad = add(store, 'memory_write', { delegate_key: 'cd'.repeat(32) })
    let reads = 0
    const result = await watchQuestions({ store, now, readWrites: async () => {
      reads += 1
      return [{ ...tx, blobs: [{ agentId: key }] }, { ...tx, digest: 'later', blobs: [{ agentId: 'cd'.repeat(32) }] }]
    } })
    assert.equal(reads, 1)
    assert.equal(result.verified, 1)
    assert.equal(store.fix(good.fix.id).verified, 1)
    assert.equal(store.question(bad.question.id).watch_state, 'stopped')
  } finally { store.close() }
})

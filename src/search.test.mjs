import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from './db.mjs'
import { searchFixes } from './search.mjs'

const address = `0x${'12'.repeat(32)}`
const deps = (store, more = {}) => ({ store, connected: true, checkpoint: async () => '200', recent: async () => false,
  check: async () => ({ checks: [], owner: 'typed-owner' }), recall: async () => [], ...more })
const fix = (store, fields = {}) => store.addFix({ title: 'Register key', error: '401 AUTH_REJECTED', body: 'Register the delegate key with addDelegateKey', source: 'issue', verify_fn: 'add_delegate_key', ...fields })

test('a decoded remove abort stays first and cannot suggest adding a key', async () => {
  const store = createStore(':memory:')
  try {
    const key = fix(store)
    const answer = { text: 'That key was not on the account when you tried to remove it.', name: 'EDelegateKeyNotFound', verify: 'remove_delegate_key' }
    const result = await searchFixes('remove_delegate_key abort 1', '', deps(store, {
      check: async () => ({ answer, transaction: { sender: 'not-typed' } }), recall: async () => [{ id: key.id, distance: 0.2 }],
    }))
    assert.deepEqual(result.finding, answer)
    assert.deepEqual(result.answer, answer)
    assert.equal(result.fix, null)
    assert.equal(result.watching, null)
    assert.equal(store.question(result.questionId).owner, null)
  } finally { store.close() }
})

test('the missing-key finding prefers a matching function and rejects package advice', async () => {
  const store = createStore(':memory:')
  try {
    const key = fix(store)
    const pkg = fix(store, { body: 'Use another package ID', verify_fn: 'memory_write' })
    const answer = { text: 'Register this key', verify: 'add_delegate_key' }
    const options = deps(store, { check: async (clean) => {
      assert.doesNotMatch(clean, /private123/)
      return { answer, owner: 'typed-owner', delegateKey: 'ab'.repeat(32), hasAccount: true }
    }, recall: async () => [{ id: pkg.id, distance: 0.1 }, { id: key.id, distance: 0.3 }] })
    const result = await searchFixes('401 token=private123', address, options)
    assert.equal(result.finding.text, answer.text)
    assert.equal(result.fix.id, key.id)
    assert.equal(result.watching, 'add_delegate_key')
    assert.equal(store.question(result.questionId).delegate_key, 'ab'.repeat(32))
    options.recall = async () => [{ id: pkg.id, distance: 0.1 }]
    assert.equal((await searchFixes('401', address, options)).fix, null)
    store.db.prepare("UPDATE fixes SET verify_fn = 'memory_write' WHERE id = ?").run(key.id)
    options.recall = async () => [{ id: pkg.id, distance: 0.1 }, { id: key.id, distance: 0.3 }]
    assert.equal((await searchFixes('401', address, options)).fix.id, key.id)
  } finally { store.close() }
})

test('only eligible new searches arm watches, with a baseline for memory writes', async () => {
  const store = createStore(':memory:')
  try {
    const saved = fix(store, { verify_fn: 'memory_write' })
    let recent = false
    let captured = false
    const options = deps(store, { checkpoint: async () => { captured = true; return '200' },
      check: async () => { assert.equal(captured, true); return { owner: 'typed-owner' } }, recent: async (owner) => { assert.equal(owner, 'typed-owner'); return recent },
      recall: async () => [{ id: saved.id, distance: 0.3 }] })
    assert.equal((await searchFixes('401 after write', address, options)).watching, 'memory_write')
    recent = true
    assert.equal((await searchFixes('401 after write', address, options)).watching, null)
    options.recall = async () => [{ id: saved.id, distance: 0.55 }]
    assert.equal((await searchFixes('401 after write', address, options)).watching, null)
    const count = store.stats().questions
    assert.equal((await searchFixes('401 AUTH_REJECTED from the relayer', address, options)).questionId, null)
    assert.equal(store.stats().questions, count)
    const creation = fix(store, { verify_fn: 'create_account' })
    options.check = async () => ({ owner: 'typed-owner', hasAccount: true })
    options.recall = async () => [{ id: creation.id, distance: 0.2 }]
    assert.equal((await searchFixes('401 after write', address, options)).watching, null)
  } finally { store.close() }
})

test('failures are stated without creating unanswered questions', async () => {
  const store = createStore(':memory:')
  try {
    const fail = async () => { throw new Error('private upstream detail') }
    const saved = fix(store)
    const result = await searchFixes('401', address, deps(store, { check: fail, recall: async () => [{ id: saved.id, distance: 0.3 }] }))
    assert.equal(result.fix.id, saved.id)
    assert.match(result.chainError, /unavailable/)
    const unavailable = await searchFixes('other error', address, deps(store, { recall: fail }))
    assert.equal(unavailable.questionId, null)
    assert.equal(unavailable.handedOff, false)
    assert.match(unavailable.memoryError, /unavailable/)
    assert.equal((await searchFixes('other error', address, deps(store, { check: fail }))).questionId, null)
    assert.equal((await searchFixes('other error', address, deps(store, { connected: false }))).questionId, null)
    assert.equal(store.pending().length, 0)
    const busy = await searchFixes('other error', address, deps(store, { recall: async () => { throw Object.assign(new Error(), { code: 'BUSY' }) } }))
    assert.match(busy.memoryError, /busy/)
  } finally { store.close() }
})

test('a retired-only match stays readable and unanswered duplicates merge', async () => {
  const store = createStore(':memory:')
  try {
    const saved = fix(store)
    store.retire(saved.id, '0.1.12')
    const result = await searchFixes('401', address, deps(store, { recall: async () => [{ id: saved.id, distance: 0.3 }] }))
    assert.equal(result.fix.status, 'retired')
    assert.equal(result.fix.body, saved.body)
    assert.equal(result.watching, null)
    const a = await searchFixes('unanswered text', address, deps(store))
    const b = await searchFixes('unanswered text', address, deps(store))
    assert.equal(a.questionId, b.questionId)
    assert.equal(store.pending().length, 1)
  } finally { store.close() }
})

test('weak matches need exact tokens and storage is bounded after scrubbing', async () => {
  const store = createStore(':memory:')
  try {
    const saved = fix(store, { error: 'Uint8Array expected' })
    const options = deps(store, { recall: async () => [{ id: saved.id, distance: 0.55 }] })
    assert.equal((await searchFixes('Uint8Array expected', address, options)).fix.possible, true)
    assert.equal((await searchFixes('404 elsewhere', address, options)).fix, null)
    const result = await searchFixes('é'.repeat(5000), address, options)
    assert.ok(Buffer.byteLength(store.question(result.questionId).error) <= 4096)
  } finally { store.close() }
})

test('a saved agent fix needs a distinctive shared token, however close the match', async () => {
  const store = createStore(':memory:')
  try {
    const saved = fix(store, { caller: 'agent', error: '401 MemWal AUTH_REJECTED' })
    store.remember(saved.id, { id: 'memory' })
    const recall = async () => [{ id: saved.id, distance: 0.42 }]
    assert.equal((await searchFixes('fetch failed ENOTFOUND from MemWal', '', deps(store, { recall }))).fix, null)
    assert.equal((await searchFixes('MemWal returned AUTH_REJECTED', '', deps(store, { recall }))).fix.agent, true)
  } finally {
    store.close()
  }
})

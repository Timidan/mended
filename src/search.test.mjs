import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from './db.mjs'
import { searchFixes } from './search.mjs'

test('active memory wins over docs, then docs, then a person, with scrubbed storage', async () => {
  const store = createStore(':memory:')
  try {
    const fix = store.addFix({ title: 'Register key', error: '401', body: 'Add a key', source: 'issue', verify_fn: 'add_delegate_key' })
    const stale = store.addFix({ title: 'Old', error: '401', body: 'Old fix', source: 'issue' })
    store.retire(stale.id, '0.1.12')
    let docs = { text: 'Docs answer' }
    let ids = [stale.id, fix.id]
    const deps = { store, connected: true, checkpoint: async () => '200',
      check: async (raw, address) => {
        assert.match(raw, /secret123/)
        assert.equal(address, 'owner')
        return { answer: docs, owner: 'owner', checks: [] }
      },
      recall: async (clean) => {
        assert.doesNotMatch(clean, /secret123/)
        return ids.map((id) => ({ id, distance: 0.3 }))
      } }
    const ask = () => searchFixes('401 token=secret123', 'owner', deps)
    const first = await ask()
    assert.equal(first.answer.text, fix.body)
    assert.equal(first.watching, 'add_delegate_key')
    assert.equal(first.fix.verified, 0)
    assert.equal(store.question(first.questionId).checkpoint, '200')
    assert.doesNotMatch(store.question(first.questionId).error, /secret123/)
    ids = [stale.id]
    assert.equal((await ask()).answer.text, docs.text)
    docs = null
    const last = await ask()
    assert.equal(last.handedOff, true)
    assert.equal(last.fix, null)
    assert.equal(store.pending().length, 1)
    assert.equal(store.stats().memory, 1)
    assert.equal(store.stats().questions, 3)
  } finally {
    store.close()
  }
})

test('either external service can fail without losing the other answer', async () => {
  const store = createStore(':memory:')
  try {
    const fix = store.addFix({ title: 'Fix', error: 'Error', body: 'Try again', source: 'person' })
    const fail = async () => { throw new Error('private upstream detail') }
    const result = await searchFixes('Error', '', { store, connected: true, check: fail, recall: async () => [{ id: fix.id, distance: 0.3 }] })
    assert.equal(result.fix.id, fix.id)
    assert.match(result.chainError, /unavailable/)
    assert.equal(result.watching, null)
    const docs = await searchFixes('Error', '', { store, connected: true, check: async () => ({ answer: { text: 'Docs' } }), recall: fail })
    assert.equal(docs.answer.text, 'Docs')
    assert.match(docs.memoryError, /unavailable/)
    assert.doesNotMatch(JSON.stringify([result, docs]), /private upstream/)
  } finally {
    store.close()
  }
})

test('a weak match needs a shared error token, or the question goes to a person', async () => {
  const store = createStore(':memory:')
  try {
    const fix = store.addFix({ title: 'Signing', error: 'Uint8Array expected', body: 'Upgrade', source: 'issue' })
    const ask = (text) => searchFixes(text, '', { store, connected: true, check: async () => ({ checks: [] }),
      recall: async () => [{ id: fix.id, distance: 0.55 }] })
    assert.equal((await ask('Uint8Array expected from sign')).fix.possible, true)
    assert.equal((await ask('404 from the gateway')).handedOff, true)
  } finally {
    store.close()
  }
})

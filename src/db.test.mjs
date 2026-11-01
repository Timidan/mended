import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from './db.mjs'

test('answers, counts and digests persist, once per question', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mended-'))
  let store = createStore(join(dir, 'test.sqlite'))
  try {
    const q = store.addQuestion({ error: '401', answered_from: 'none', state: 'handed_off' })
    const fix = store.answer(q.id, { title: 'Register key', body: 'Add the key.' })
    assert.equal(store.answer(q.id, { title: 'Duplicate', body: 'Ignored' }).id, fix.id)
    store.remember(fix.id, 'memory-one')
    assert.equal(store.pending().length, 0)
    store.report(q.id)
    store.report(q.id)
    store.verify(q.id, 'digest', new Date().toISOString())
    store.verify(q.id, 'other', new Date().toISOString())
    store.close()
    store = createStore(join(dir, 'test.sqlite'))
    assert.equal(store.fix(fix.id).reported, 1)
    assert.equal(store.fix(fix.id).verified, 1)
    assert.deepEqual(store.fix(fix.id).digests, ['digest'])
    assert.equal(store.stats().questions, 1)
    assert.equal(store.stats().memory, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

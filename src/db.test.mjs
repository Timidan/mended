import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrate.mjs'
import { createStore } from './db.mjs'

test('answers, counts and digests persist, once per question', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mended-'))
  let store = createStore(join(dir, 'test.sqlite'))
  try {
    const q = store.addQuestion({ error: '401', owner: 'owner', answered_from: 'none', state: 'handed_off' })
    const fix = store.answer(q.id, { title: 'Register key', body: 'Add the key.' })
    assert.equal(store.answer(q.id, { title: 'Duplicate', body: 'Ignored' }).id, fix.id)
    store.remember(fix.id, { id: 'memory-one' })
    assert.equal(store.pending().length, 0)
    store.report(q.id, 'caller')
    store.report(q.id, 'caller')
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


test('unique digests, distinct owners and daily caller reports count honestly', () => {
  const store = createStore(':memory:')
  try {
    const fix = store.addFix({ title: 'Fix', error: 'Error', body: 'Fix', source: 'issue' })
    const question = (owner) => store.addQuestion({ error: 'same error', owner, fix_id: fix.id, answered_from: 'memory', state: 'answered' })
    const a = question('owner-one')
    const b = question('owner-one')
    const c = question('owner-two')
    store.verify(a.id, 'digest-one', 'now')
    assert.equal(store.verify(b.id, 'digest-one', 'now').changes, 0)
    store.verify(b.id, 'digest-two', 'now')
    store.verify(c.id, 'digest-three', 'now')
    assert.equal(store.fix(fix.id).verified, 2)
    store.report(a.id, 'caller', '2026-11-01T12:00:00Z')
    store.report(b.id, 'caller', '2026-11-01T12:01:00Z')
    assert.equal(store.fix(fix.id).reported, 1)
    store.report(a.id, 'caller', '2026-11-02T12:00:00Z')
    assert.equal(store.fix(fix.id).reported, 2)
    store.report(a.id, 'other-caller', '2026-11-02T12:00:00Z')
    assert.equal(store.fix(fix.id).reported, 3)
    assert.equal(store.stats().questions, 1)
    assert.equal(store.stats().memory, 1)
  } finally { store.close() }
})

test('questions merge, can be dismissed, are bounded, and old unanswered rows expire', () => {
  const store = createStore(':memory:')
  try {
    const fields = { error: 'unanswered', state: 'handed_off', answered_from: 'none' }
    const a = store.addQuestion(fields)
    assert.equal(store.addQuestion(fields).id, a.id)
    store.dismiss(a.id)
    assert.equal(store.pending().length, 0)
    assert.equal(store.stats().questions, 0)
    const old = store.addQuestion({ ...fields, error: 'old', created_at: '2020-01-01T00:00:00Z' })
    store.prune()
    assert.equal(store.question(old.id), undefined)
    for (let i = 0; i < 101; i++) store.addQuestion({ ...fields, error: `error ${i}` })
    assert.equal(store.pending().length, 100)
    const big = store.addQuestion({ ...fields, error: 'é'.repeat(3000) })
    assert.ok(Buffer.byteLength(big.error) <= 4096)
  } finally { store.close() }
})


test('startup migration is additive and repeatable on legacy rows', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE fixes (id TEXT PRIMARY KEY, verify_fn TEXT, memory_id TEXT, body TEXT);
      CREATE TABLE questions (id TEXT PRIMARY KEY, created_at TEXT);
      CREATE TABLE verifications (question_id TEXT PRIMARY KEY, fix_id TEXT, digest TEXT);
      CREATE TABLE reports (question_id TEXT PRIMARY KEY, fix_id TEXT);
      INSERT INTO fixes VALUES ('65159af00729', 'create_account', 'existing-memory', 'Preserve this');
      INSERT INTO questions VALUES ('question', '2026-11-01');`)
    migrate(db)
    migrate(db)
    const fix = db.prepare('SELECT * FROM fixes').get()
    assert.equal(fix.verify_fn, 'memory_write')
    assert.equal(fix.memory_id, 'existing-memory')
    assert.equal(fix.body, 'Preserve this')
    assert.equal(db.prepare('SELECT watch_state FROM questions').get().watch_state, 'stopped')
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally { db.close() }
})

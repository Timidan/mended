import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { migrate } from './migrate.mjs'
import { limitText, scrub } from './scrub.mjs'

const counts = `SELECT f.*,
  (SELECT count(DISTINCT owner) FROM verifications v WHERE v.fix_id = f.id AND v.owner IS NOT f.author) AS verified,
  (SELECT count(*) FROM reports r WHERE r.fix_id = f.id) +
  (SELECT count(*) FROM report_callers r WHERE r.fix_id = f.id) AS reported,
  (SELECT json_group_array(digest) FROM verifications v WHERE v.fix_id = f.id AND v.owner IS NOT NULL AND v.owner IS NOT f.author) AS digests
  FROM fixes f`

// An agent's fix stays out of search until it reaches Walrus Memory, and a person can still remove it
export const shareable = (fix) => !fix.caller || Boolean(fix.memory_id && fix.status === 'active')

export function createStore(path = process.env.DB_PATH ?? 'data/mended.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS fixes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, error TEXT NOT NULL, body TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('issue', 'person')), source_url TEXT,
      verify_fn TEXT, sdk_version TEXT, retire_at_version TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
      retired_reason TEXT, memory_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, error TEXT NOT NULL, owner TEXT, checkpoint TEXT,
      fix_id TEXT REFERENCES fixes(id),
      answered_from TEXT NOT NULL CHECK (answered_from IN ('memory', 'docs', 'none')),
      state TEXT NOT NULL CHECK (state IN ('open', 'handed_off', 'answered')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verifications (
      question_id TEXT PRIMARY KEY REFERENCES questions(id),
      fix_id TEXT NOT NULL REFERENCES fixes(id), digest TEXT NOT NULL, at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      question_id TEXT PRIMARY KEY REFERENCES questions(id),
      fix_id TEXT NOT NULL REFERENCES fixes(id), at TEXT NOT NULL
    );
  `)
  migrate(db)
  const row = (fix) => fix ? { ...fix, digests: JSON.parse(fix.digests) } : null
  const store = {
    db,
    close: () => db.close(),
    fix: (id) => row(db.prepare(`${counts} WHERE f.id = ?`).get(id)),
    fixes: () => db.prepare(`${counts} ORDER BY f.created_at DESC`).all().map(row),
    question: (id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(id),
    pending: () => db.prepare(`SELECT q.* FROM questions q LEFT JOIN fixes f ON f.id = q.fix_id
      WHERE q.dismissed = 0 AND (q.state = 'handed_off' OR (f.source = 'person' AND f.memory_id IS NULL))
      AND NOT (f.caller IS NOT NULL AND q.watch_state = 'watching' AND q.created_at > ?)
      ORDER BY q.created_at LIMIT 100`).all(new Date(Date.now() - 7 * 86400000).toISOString()).map((q) => ({ ...q, fix: q.fix_id ? store.fix(q.fix_id) : null })),
    addFix(fix) {
      const { id = randomUUID(), title, error, body, source, source_url = null, verify_fn = null,
        sdk_version = null, retire_at_version = null, caller = null, author = null, created_at = new Date().toISOString() } = fix
      db.prepare(`INSERT INTO fixes (id, title, error, body, source, source_url, verify_fn,
        sdk_version, retire_at_version, caller, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, error, body, source, source_url, verify_fn, sdk_version, retire_at_version, caller, author, created_at)
      return store.fix(id)
    },
    addQuestion(question) {
      const { id = randomUUID(), owner = null, checkpoint = null, fix_id = null, delegate_key = null,
        watch_state = 'stopped', answered_from, state, created_at = new Date().toISOString() } = question
      const error = limitText(scrub(question.error))
      if (state === 'handed_off') {
        const existing = db.prepare("SELECT * FROM questions WHERE error = ? AND owner IS ? AND state = 'handed_off' AND dismissed = 0 LIMIT 1").get(error, owner)
        if (existing) return existing
      }
      db.prepare(`INSERT INTO questions (id, error, owner, checkpoint, fix_id, answered_from, state, created_at, delegate_key, watch_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, error, owner, checkpoint == null ? null : String(checkpoint), fix_id, answered_from, state, created_at, delegate_key, watch_state)
      return store.question(id)
    },
    answer(id, fields) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const question = store.question(id)
        if (!question) throw new Error('Question not found')
        let fix = question.fix_id ? store.fix(question.fix_id) : null
        if (!fix) {
          if (question.state !== 'handed_off') throw new Error('Question already answered')
          const error = limitText(scrub(fields.error ?? question.error))
          fix = store.addFix({ ...fields, error, source: 'person' })
          db.prepare('UPDATE questions SET error = ? WHERE id = ?').run(error, id)
          db.prepare("UPDATE questions SET fix_id = ?, state = 'answered' WHERE id = ?").run(fix.id, id)
        }
        db.exec('COMMIT')
        return fix
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    // Also replaces a stored fix that was shown for this question and didn't solve it
    saveAgentFix(id, fields) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const fix = store.addFix({ ...fields, source: 'person' })
        db.prepare(`UPDATE questions SET error = ?, fix_id = ?, answered_from = 'none', state = 'answered', watch_state = 'stopped'
          WHERE id = ?`).run(fix.error, fix.id, id)
        db.exec('COMMIT')
        return fix
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    remember(id, memory) {
      db.prepare('UPDATE fixes SET memory_id = ?, blob_id = ?, blob_object_id = ? WHERE id = ?')
        .run(memory.id, memory.blob_id ?? null, memory.blob_object_id ?? null, id)
    },
    setBlob: (id, objectId) => db.prepare('UPDATE fixes SET blob_object_id = ? WHERE id = ?').run(objectId, id),
    dismiss: (id) => db.prepare("UPDATE questions SET dismissed = 1, watch_state = 'stopped' WHERE id = ?").run(id),
    report(id, caller, now = new Date().toISOString()) {
      db.prepare(`INSERT OR IGNORE INTO report_callers (question_id, fix_id, at, caller, day)
        SELECT id, fix_id, ?, ?, ? FROM questions WHERE id = ? AND fix_id IS NOT NULL`).run(now, caller, now.slice(0, 10), id)
      const question = store.question(id)
      return question?.fix_id ? store.fix(question.fix_id) : null
    },
    watching(since) {
      return db.prepare(`SELECT q.*, f.verify_fn FROM questions q JOIN fixes f ON f.id = q.fix_id
        WHERE q.owner IS NOT NULL AND q.checkpoint IS NOT NULL AND f.verify_fn IS NOT NULL
        AND q.watch_state = 'watching' AND f.status = 'active' AND q.created_at > ?
        AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.question_id = q.id)`).all(since)
    },
    watch: (id) => db.prepare("UPDATE questions SET watch_state = 'watching' WHERE id = ?").run(id),
    wasVerified: (id) => Boolean(db.prepare('SELECT 1 FROM verifications WHERE question_id = ?').get(id)),
    savedBy: (caller) => db.prepare('SELECT count(*) AS n FROM fixes WHERE caller = ?').get(caller).n,
    // Five at most per run: each write takes about 30 seconds and spends Walrus Memory's hourly points
    unpublished: () => db.prepare(`${counts} WHERE f.caller IS NOT NULL AND f.memory_id IS NULL AND f.status = 'active'
      AND EXISTS (SELECT 1 FROM verifications v JOIN questions q ON q.id = v.question_id WHERE v.fix_id = f.id AND q.dismissed = 0)
      ORDER BY f.created_at LIMIT 5`).all().map(row),
    remove: (id) => db.prepare("UPDATE fixes SET status = 'retired', retired_reason = 'Removed by a person' WHERE id = ? AND caller IS NOT NULL").run(id),
    stopWatching: (id) => db.prepare("UPDATE questions SET watch_state = 'stopped' WHERE id = ?").run(id),
    verify(questionId, digest, at) {
      const result = db.prepare(`INSERT OR IGNORE INTO verifications (question_id, fix_id, digest, at, owner)
        SELECT id, fix_id, ?, ?, owner FROM questions WHERE id = ? AND fix_id IS NOT NULL AND owner IS NOT NULL`).run(digest, at, questionId)
      store.stopWatching(questionId)
      return result
    },
    prune() {
      return db.prepare("DELETE FROM questions WHERE fix_id IS NULL AND created_at < ?")
        .run(new Date(Date.now() - 30 * 86400000).toISOString())
    },
    retire: (id, version) => db.prepare("UPDATE fixes SET status = 'retired', retired_reason = ? WHERE id = ? AND status = 'active'")
      .run(`Fixed in SDK ${version}`, id),
    stats() {
      const days = db.prepare(`SELECT substr(created_at, 1, 10) AS day, count(DISTINCT error) AS questions,
        count(DISTINCT CASE WHEN answered_from = 'memory' THEN error END) AS memory FROM questions GROUP BY day ORDER BY day`).all()
      const totals = db.prepare("SELECT count(DISTINCT error) AS questions, count(DISTINCT CASE WHEN answered_from = 'memory' THEN error END) AS memory FROM questions").get()
      const agents = db.prepare(`SELECT (SELECT count(*) FROM fixes WHERE caller IS NOT NULL AND memory_id IS NOT NULL AND status = 'active') AS agentFixes,
        (SELECT count(DISTINCT q.error) FROM questions q JOIN fixes f ON f.id = q.fix_id WHERE f.caller IS NOT NULL AND q.answered_from = 'memory') AS agentAnswers`).get()
      return { days, ...totals, ...agents }
    },
  }
  store.prune()
  return store
}

let store
export const getStore = () => store ??= createStore()

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const counts = `SELECT f.*,
  (SELECT count(*) FROM verifications v WHERE v.fix_id = f.id) AS verified,
  (SELECT count(*) FROM reports r WHERE r.fix_id = f.id) AS reported,
  (SELECT json_group_array(digest) FROM verifications v WHERE v.fix_id = f.id) AS digests
  FROM fixes f`

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
  const row = (fix) => fix ? { ...fix, digests: JSON.parse(fix.digests) } : null
  const store = {
    db,
    close: () => db.close(),
    fix: (id) => row(db.prepare(`${counts} WHERE f.id = ?`).get(id)),
    fixes: () => db.prepare(`${counts} ORDER BY f.created_at DESC`).all().map(row),
    question: (id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(id),
    pending: () => db.prepare(`SELECT q.* FROM questions q LEFT JOIN fixes f ON f.id = q.fix_id
      WHERE q.state = 'handed_off' OR (f.source = 'person' AND f.memory_id IS NULL)
      ORDER BY q.created_at`).all().map((q) => ({ ...q, fix: q.fix_id ? store.fix(q.fix_id) : null })),
    addFix(fix) {
      const { id = randomUUID(), title, error, body, source, source_url = null, verify_fn = null,
        sdk_version = null, retire_at_version = null, created_at = new Date().toISOString() } = fix
      db.prepare(`INSERT INTO fixes (id, title, error, body, source, source_url, verify_fn,
        sdk_version, retire_at_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, error, body, source, source_url, verify_fn, sdk_version, retire_at_version, created_at)
      return store.fix(id)
    },
    addQuestion(question) {
      const { id = randomUUID(), error, owner = null, checkpoint = null, fix_id = null,
        answered_from, state, created_at = new Date().toISOString() } = question
      db.prepare(`INSERT INTO questions (id, error, owner, checkpoint, fix_id, answered_from, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, error, owner, checkpoint == null ? null : String(checkpoint), fix_id, answered_from, state, created_at)
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
          fix = store.addFix({ ...fields, error: question.error, source: 'person' })
          db.prepare("UPDATE questions SET fix_id = ?, state = 'answered' WHERE id = ?").run(fix.id, id)
        }
        db.exec('COMMIT')
        return fix
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    remember: (id, memoryId) => db.prepare('UPDATE fixes SET memory_id = ? WHERE id = ?').run(memoryId, id),
    report(id) {
      db.prepare(`INSERT OR IGNORE INTO reports (question_id, fix_id, at)
        SELECT id, fix_id, ? FROM questions WHERE id = ? AND fix_id IS NOT NULL`).run(new Date().toISOString(), id)
      const question = store.question(id)
      return question?.fix_id ? store.fix(question.fix_id) : null
    },
    watching(since) {
      return db.prepare(`SELECT q.*, f.verify_fn FROM questions q JOIN fixes f ON f.id = q.fix_id
        WHERE q.owner IS NOT NULL AND q.checkpoint IS NOT NULL AND f.verify_fn IS NOT NULL
        AND f.status = 'active' AND q.created_at > ?
        AND NOT EXISTS (SELECT 1 FROM verifications v WHERE v.question_id = q.id)`).all(since)
    },
    verify(questionId, digest, at) {
      return db.prepare(`INSERT OR IGNORE INTO verifications (question_id, fix_id, digest, at)
        SELECT id, fix_id, ?, ? FROM questions WHERE id = ? AND fix_id IS NOT NULL`).run(digest, at, questionId)
    },
    retire: (id, version) => db.prepare("UPDATE fixes SET status = 'retired', retired_reason = ? WHERE id = ? AND status = 'active'")
      .run(`Fixed in SDK ${version}`, id),
    stats() {
      const days = db.prepare(`SELECT substr(created_at, 1, 10) AS day, count(*) AS questions,
        sum(answered_from = 'memory') AS memory FROM questions GROUP BY day ORDER BY day`).all()
      return { days, questions: days.reduce((n, d) => n + d.questions, 0), memory: days.reduce((n, d) => n + d.memory, 0) }
    },
  }
  return store
}

let store
export const getStore = () => store ??= createStore()

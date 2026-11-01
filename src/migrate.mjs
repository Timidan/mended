const WRITE_FIXES = [
  '65159af00729', 'c6f57630128b', 'cb5237bcff16', '16efc074d58e', '86dc883e7f90',
  '618bed8ab2f1', '123711791e6a', '2bf1e9433f13', '7f50766cef5a', '3dd3c2709872',
  'cb8da292ea27', 'c6613fe62d3e', 'e781ecddc603',
]

export function migrate(db) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const add = (table, name, type) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
      }
    }
    add('fixes', 'blob_object_id', 'TEXT')
    add('fixes', 'blob_id', 'TEXT')
    add('questions', 'delegate_key', 'TEXT')
    add('questions', 'watch_state', "TEXT NOT NULL DEFAULT 'stopped'")
    add('questions', 'dismissed', 'INTEGER NOT NULL DEFAULT 0')
    add('verifications', 'owner', 'TEXT')
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS verification_digest ON verifications(fix_id, digest);
      CREATE TABLE IF NOT EXISTS report_callers (
        fix_id TEXT NOT NULL REFERENCES fixes(id), caller TEXT NOT NULL, day TEXT NOT NULL,
        question_id TEXT NOT NULL REFERENCES questions(id), at TEXT NOT NULL,
        PRIMARY KEY (fix_id, caller, day)
      );
      CREATE INDEX IF NOT EXISTS reports_fix ON reports(fix_id);
      CREATE INDEX IF NOT EXISTS verifications_fix ON verifications(fix_id);
      CREATE INDEX IF NOT EXISTS questions_created ON questions(created_at);
    `)
    const update = db.prepare("UPDATE fixes SET verify_fn = 'memory_write' WHERE id = ?")
    for (const id of WRITE_FIXES) update.run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

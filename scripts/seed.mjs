import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { getStore } from '../src/db.mjs'
import * as memory from '../src/memory.mjs'
import { scrub } from '../src/scrub.mjs'

export async function seedFixes(rows, { store = getStore(), memories = memory } = {}) {
  const result = { inserted: 0, remembered: 0, skipped: 0, failed: 0, connected: memories.connected }
  for (const entry of rows) {
    const id = createHash('sha256').update(JSON.stringify([entry.source_url, entry.title, entry.error])).digest('hex').slice(0, 12)
    let fix = store.fix(id)
    if (!fix) {
      fix = store.addFix({ id, title: scrub(entry.title), error: scrub(entry.error), body: scrub(entry.fix), source: 'issue',
        source_url: entry.source_url ? scrub(entry.source_url) : null, verify_fn: entry.verify_fn || null,
        sdk_version: entry.sdk_version || null, retire_at_version: entry.retire_at_version || null })
      result.inserted += 1
    }
    if (fix.memory_id) {
      result.skipped += 1
      continue
    }
    try {
      const memoryId = await memories.remember(fix)
      if (memoryId) {
        store.remember(id, memoryId)
        result.remembered += 1
      }
    } catch {
      result.failed += 1
    }
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = JSON.parse(await readFile(new URL('../data/seed-fixes.json', import.meta.url), 'utf8'))
  const result = await seedFixes(rows)
  console.log(JSON.stringify(result))
  getStore().close()
  if (result.failed) process.exitCode = 1
}

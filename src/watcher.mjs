import { MEMWAL, callsAfter, writesAfter, accountOfOwner, readObject } from './sui.mjs'
import { normalizeKey } from './check.mjs'
import { getStore } from './db.mjs'
import * as memory from './memory.mjs'

const WEEK = 7 * 86400000

export async function watchQuestions({ store = getStore(), readCalls = callsAfter, readWrites = writesAfter,
  accountId = accountOfOwner, object = readObject, now = Date.now() } = {}) {
  store.prune()
  const groups = new Map()
  for (const q of store.watching(new Date(now - WEEK).toISOString())) {
    const name = q.verify_fn.replace(`${MEMWAL.package}::`, '')
    const kind = name === 'memory_write' ? name : `${MEMWAL.package}::${name.includes('::') ? name : `account::${name}`}`
    const key = `${q.owner}:${kind}`
    if (!groups.has(key)) groups.set(key, { owner: q.owner, kind, questions: [] })
    groups.get(key).questions.push(q)
  }
  let verified = 0
  let failed = 0
  for (const { owner, kind, questions } of groups.values()) {
    questions.sort((a, b) => BigInt(a.checkpoint) < BigInt(b.checkpoint) ? -1 : 1)
    try {
      const afterCheckpoint = questions[0].checkpoint
      const writes = kind === 'memory_write'
      const calls = writes ? await readWrites({ owner, afterCheckpoint, throughCheckpoint: questions.at(-1).checkpoint }) : await readCalls({
        sender: owner, fn: kind, afterCheckpoint, throughCheckpoint: questions.at(-1).checkpoint, first: 1,
      })
      let account
      for (const q of questions) {
        const first = calls.find((tx) => BigInt(tx.checkpoint) > BigInt(q.checkpoint) &&
          Date.parse(tx.timestamp) >= Date.parse(q.created_at) && (writes ? tx.owner === owner : tx.sender === owner))
        if (!first) continue
        let success = first.ok
        if (writes) success &&= first.blobs.some((blob) => !q.delegate_key || normalizeKey(blob.agentId) === normalizeKey(q.delegate_key))
        if (success && kind.endsWith('::add_delegate_key') && q.delegate_key) {
          if (!account) {
            const id = await accountId(owner)
            account = id ? (await object(id))?.json : null
          }
          success = Boolean(account?.delegate_keys.some((key) => normalizeKey(key.public_key) === normalizeKey(q.delegate_key)))
        }
        if (success) verified += Number(store.verify(q.id, first.digest, first.timestamp).changes)
        else store.stopWatching(q.id)
      }
    } catch {
      failed += 1
    }
  }
  return { verified, failed }
}

export async function publishVerified({ store = getStore(), memories = memory } = {}) {
  let published = 0
  for (const fix of store.unpublished()) {
    try {
      const id = await memories.remember(fix)
      if (id) {
        store.remember(fix.id, id)
        published += 1
      }
    } catch {} // left unpublished, so the next run retries it
  }
  return published
}

export function startWatcher() {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      const { failed } = await watchQuestions()
      if (failed) console.warn(`Tatum unavailable for ${failed} verification checks`)
      await publishVerified()
    } catch {
      console.warn('Verification check unavailable')
    } finally {
      running = false
    }
  }, 300_000)
  timer.unref()
  return timer
}

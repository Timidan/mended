import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MemWal } from '@mysten-incubation/memwal'
import { scrub } from './scrub.mjs'
import { ownedBlobs } from './sui.mjs'

// Retuned on 5 Nov with 64 searches from five test agents: right and wrong matches overlapped from about 0.23 to 0.54,
// so distance alone never decides. search.mjs also needs shared words, and calls a match sure only below SURE_DISTANCE.
export const MAX_DISTANCE = 0.58
export const SURE_DISTANCE = 0.4
const WRITE_GAP = 11_000
const NAMESPACE = process.env.MEMWAL_NAMESPACE ?? 'fixes'
const setting = (env, file) => {
  if (process.env[env] !== undefined) return process.env[env].trim()
  try {
    return readFileSync(join(homedir(), file), 'utf8').trim()
  } catch {
    return ''
  }
}

export function createRecallBudget(now = Date.now) {
  let calls = []
  const cache = new Map()
  return async (text, read) => {
    const at = now()
    calls = calls.filter((time) => time > at - 3600000)
    for (const [key, entry] of cache) if (entry.at <= at - 300000) cache.delete(key)
    if (cache.has(text)) return cache.get(text).result
    if (calls.length >= 400 || calls.filter((time) => time > at - 60000).length >= 20) {
      throw Object.assign(new Error('Memory is busy. Try again shortly.'), { code: 'BUSY' })
    }
    calls.push(at)
    const result = Promise.resolve().then(read)
    cache.set(text, { at, result })
    try {
      return await result
    } catch (error) {
      cache.delete(text)
      throw error
    }
  }
}
const recallBudget = createRecallBudget()

export function createMemory({ accountId, client, budget = recallBudget, listBlobs = ownedBlobs, now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const connected = Boolean(accountId)
  let line = Promise.resolve()
  let nextWrite = 0
  const sdk = () => client ??= MemWal.create({ key: setting('MEMWAL_KEY', '.memwal-key'), accountId, namespace: NAMESPACE })
  return {
    connected,
    async recall(error) {
      if (!connected) return []
      const text = scrub(error)
      const { results } = await budget(text, () => sdk().recall({ query: text, namespace: NAMESPACE, maxDistance: MAX_DISTANCE, limit: 10 }))
      return results.filter((hit) => Number.isFinite(hit.distance) && hit.distance < MAX_DISTANCE)
        .map((hit) => ({ id: hit.text.match(/^\[fix:([a-zA-Z0-9-]+)\]/)?.[1], distance: hit.distance, blob_id: hit.blob_id })).filter((hit) => hit.id)
    },
    remember(fix) {
      if (!connected) return Promise.resolve(null)
      const run = line.then(async () => {
        await sleep(Math.max(0, nextWrite - now()))
        nextWrite = now() + WRITE_GAP
        const text = `[fix:${fix.id}]\n${scrub(fix.title)}\n${scrub(fix.error)}\n${scrub(fix.body)}`
        const result = await sdk().rememberAndWait(text, NAMESPACE, { idempotencyKey: `fix:${fix.id}`, dedupe: true })
        if (!result.id || !result.blob_id) throw new Error('Memory write did not complete')
        let objectId = null
        try {
          objectId = (await listBlobs(result.owner, NAMESPACE)).find((b) => b.blobId === result.blob_id)?.objectId ?? null
        } catch {}
        return { id: result.id, blob_id: result.blob_id, blob_object_id: objectId }
      })
      line = run.catch(() => {})
      return run
    },
  }
}

export const { connected, recall, remember } = createMemory({ accountId: setting('MEMWAL_ACCOUNT_ID', '.memwal-account') })

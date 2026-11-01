import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MemWal } from '@mysten-incubation/memwal'
import { scrub } from './scrub.mjs'

// Tuned on Mainnet with 27 questions. Below SURE_DISTANCE, matches were right. Between the two, right and wrong
// matches overlapped, so search.mjs also requires an exact error token there.
export const MAX_DISTANCE = 0.58
export const SURE_DISTANCE = 0.5
const WRITE_GAP = 11_000
const setting = (env, file) => {
  if (process.env[env] !== undefined) return process.env[env].trim()
  try {
    return readFileSync(join(homedir(), file), 'utf8').trim()
  } catch {
    return ''
  }
}

export function createMemory({ accountId, client, now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const connected = Boolean(accountId)
  let line = Promise.resolve()
  let nextWrite = 0
  const sdk = () => client ??= MemWal.create({ key: setting('MEMWAL_KEY', '.memwal-key'), accountId, namespace: 'fixes' })
  return {
    connected,
    async recall(error) {
      if (!connected) return []
      const { results } = await sdk().recall({ query: scrub(error), namespace: 'fixes', maxDistance: MAX_DISTANCE, limit: 10 })
      return results.filter((hit) => Number.isFinite(hit.distance) && hit.distance < MAX_DISTANCE)
        .map((hit) => ({ id: hit.text.match(/^\[fix:([a-zA-Z0-9-]+)\]/)?.[1], distance: hit.distance })).filter((hit) => hit.id)
    },
    remember(fix) {
      if (!connected) return Promise.resolve(null)
      const run = line.then(async () => {
        await sleep(Math.max(0, nextWrite - now()))
        nextWrite = now() + WRITE_GAP
        const text = `[fix:${fix.id}]\n${scrub(fix.title)}\n${scrub(fix.error)}\n${scrub(fix.body)}`
        const result = await sdk().rememberAndWait(text, 'fixes', { idempotencyKey: `fix:${fix.id}`, dedupe: true })
        if (!result.id || !result.blob_id) throw new Error('Memory write did not complete')
        return result.id
      })
      line = run.catch(() => {})
      return run
    },
  }
}

export const { connected, recall, remember } = createMemory({ accountId: setting('MEMWAL_ACCOUNT_ID', '.memwal-account') })

import { accountCheck } from './check.mjs'
import { latestCheckpoint } from './sui.mjs'
import { scrub } from './scrub.mjs'
import { getStore } from './db.mjs'
import * as memory from './memory.mjs'
import { SURE_DISTANCE } from './memory.mjs'

// Status codes and identifiers such as Uint8Array or AUTH_REJECTED
const TOKEN = /\b(?:[1-5]\d\d|[A-Za-z]+[A-Z0-9][A-Za-z0-9_]*|[a-z]+_[a-z_]+)\b/g
const tokens = (text) => new Set(text.match(TOKEN) ?? [])
const sharesToken = (a, b) => [...tokens(a)].some((token) => tokens(b).has(token))

export async function searchFixes(error, address = '', { store = getStore(), check = accountCheck, recall = memory.recall,
  connected = memory.connected, checkpoint = latestCheckpoint } = {}) {
  const createdAt = new Date().toISOString()
  const clean = scrub(error)
  const [chain, recalled] = await Promise.allSettled([check(error, address), clean ? recall(clean) : []])
  const result = chain.status === 'fulfilled' ? chain.value : {
    checks: [], transaction: null, retry: null, answer: null, nothingToCheck: false, chainError: 'Account check unavailable',
  }
  if (result.chainError) result.chainError = 'Account check unavailable'
  const memoryError = recalled.status === 'rejected' ? 'Walrus Memory unavailable' : null
  const hits = recalled.status === 'fulfilled' ? recalled.value : []
  const hit = hits.find(({ id, distance }) => {
    const candidate = store.fix(id)
    return candidate?.status === 'active' && (distance < SURE_DISTANCE || sharesToken(clean, candidate.error))
  })
  const fix = hit ? store.fix(hit.id) : null
  const owner = result.owner ?? result.answer?.owner ?? result.transaction?.sender ?? null
  let atCheckpoint = null
  if (owner) {
    try {
      atCheckpoint = await checkpoint()
    } catch {
      result.chainError = 'Verification checkpoint unavailable'
    }
  }
  // An address on its own is an account check, not a question to answer or count
  if (!clean) return { ...result, fix: null, questionId: null, handedOff: false, watching: null, memory: { connected }, memoryError: null }
  const answeredFrom = fix ? 'memory' : result.answer ? 'docs' : 'none'
  const question = store.addQuestion({ error: clean, owner, checkpoint: atCheckpoint, fix_id: fix?.id ?? null,
    answered_from: answeredFrom, state: answeredFrom === 'none' ? 'handed_off' : 'answered', created_at: createdAt })
  return {
    ...result,
    answer: fix ? { text: fix.body, name: fix.title, verify: fix.verify_fn, owner } : result.answer,
    fix: fix ? { id: fix.id, title: fix.title, body: fix.body, verified: fix.verified, reported: fix.reported, sourceUrl: fix.source_url,
      possible: hit.distance >= SURE_DISTANCE } : null,
    questionId: question.id,
    handedOff: question.state === 'handed_off',
    watching: fix?.verify_fn && owner && atCheckpoint != null ? fix.verify_fn : null,
    memory: { connected },
    memoryError,
  }
}

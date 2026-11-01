import { accountCheck, parse } from './check.mjs'
import { latestCheckpoint, recentWrite, MEMWAL } from './sui.mjs'
import { scrub, limitText } from './scrub.mjs'
import { getStore } from './db.mjs'
import * as memory from './memory.mjs'
import { SURE_DISTANCE, MAX_DISTANCE } from './memory.mjs'

const TOKEN = /\b(?:[1-5]\d\d|[A-Za-z]+[A-Z0-9][A-Za-z0-9_]*|[a-z]+_[a-z_]+)\b/g
const tokens = (text) => new Set(text.match(TOKEN) ?? [])
const sharesToken = (a, b) => [...tokens(a)].some((token) => tokens(b).has(token))
const kind = (fn) => fn?.replace(`${MEMWAL.package}::`, '').replace(/^account::/, '')
const EXAMPLES = new Set([
  'My remove_delegate_key call failed:\nHkjZZKkt35QdjrWGbUFBR5eyMuHQaLLRsGCYwvuzC5DS',
  '401 AUTH_REJECTED from the relayer',
  `Package object does not exist: ${MEMWAL.testnetPackage}`,
])

function relevant(fix, finding, text) {
  if (!finding) return true
  if (kind(fix.verify_fn) && kind(fix.verify_fn) === kind(finding.verify)) return true
  if (!sharesToken(text, fix.error)) return false
  // A generic 401 cannot override a diagnosed missing key with a package change.
  if (kind(finding.verify) === 'add_delegate_key') return /addDelegateKey|register the delegate key/i.test(fix.body)
  if (finding.name === 'EDelegateKeyNotFound') return false
  return true
}

export async function searchFixes(error, address = '', { store = getStore(), check = accountCheck, recall = memory.recall,
  connected = memory.connected, checkpoint = latestCheckpoint, recent = recentWrite, now = Date.now } = {}) {
  const clean = limitText(scrub(error))
  const example = EXAMPLES.has(error.trim())
  let start = null
  let boundaryError = false
  if (clean && !example && parse(`${clean}\n${scrub(address, { publicKeys: true })}`).ids.length) {
    try { start = await checkpoint() } catch { boundaryError = true }
  }
  const at = now()
  const createdAt = new Date(at).toISOString()
  const [chain, recalled] = await Promise.allSettled([check(clean, address), clean ? recall(clean) : []])
  const result = chain.status === 'fulfilled' ? chain.value : {
    checks: [], transaction: null, retry: null, answer: null, nothingToCheck: false, chainError: 'Account check unavailable',
  }
  if (boundaryError) result.chainError = 'Verification checkpoint unavailable'
  const finding = result.answer ?? null
  const memoryError = recalled.status === 'rejected'
    ? recalled.reason?.code === 'BUSY' ? 'Memory is busy. Try again shortly.' : 'Walrus Memory unavailable' : null
  const hits = recalled.status === 'fulfilled' ? recalled.value : []
  const candidates = hits.map((hit) => ({ ...hit, fix: store.fix(hit.id) })).filter(({ fix, distance }) =>
    fix && distance < MAX_DISTANCE && (distance < SURE_DISTANCE || sharesToken(clean, fix.error)) && relevant(fix, finding, clean))
  candidates.sort((a, b) => Number(b.fix.status === 'active') - Number(a.fix.status === 'active') ||
    Number(Boolean(finding?.verify) && kind(b.fix.verify_fn) === kind(finding.verify)) - Number(Boolean(finding?.verify) && kind(a.fix.verify_fn) === kind(finding.verify)) || a.distance - b.distance)
  const hit = candidates[0]
  const fix = hit?.fix ?? null
  const owner = result.owner ?? null
  let atCheckpoint = null
  let watching = null
  if (!example && clean && fix?.status === 'active' && fix.verify_fn && hit.distance < SURE_DISTANCE && owner && start != null && !result.chainError &&
    !(kind(fix.verify_fn) === 'create_account' && result.hasAccount)) {
    try {
      if (fix.verify_fn !== 'memory_write' || !await recent(owner, at)) {
        atCheckpoint = start
        watching = fix.verify_fn
      }
    } catch {
      result.chainError = 'Verification check unavailable'
    }
  }
  const answeredFrom = fix ? 'memory' : finding ? 'docs' : 'none'
  const canRecord = clean && !example && (answeredFrom !== 'none' || (connected && !memoryError && !result.chainError))
  const question = canRecord ? store.addQuestion({ error: clean, owner, checkpoint: atCheckpoint, fix_id: fix?.id ?? null,
    delegate_key: result.delegateKey ?? null, watch_state: watching ? 'watching' : 'stopped',
    answered_from: answeredFrom, state: answeredFrom === 'none' ? 'handed_off' : 'answered', created_at: createdAt }) : null
  return {
    ...result, finding,
    fix: fix ? { id: fix.id, title: fix.title, body: fix.body, verify_fn: fix.verify_fn, status: fix.status,
      retiredReason: fix.retired_reason, verified: fix.verified, reported: fix.reported, sourceUrl: fix.source_url,
      possible: hit.distance >= SURE_DISTANCE } : null,
    questionId: question?.id ?? null,
    handedOff: question?.state === 'handed_off',
    watching,
    memory: { connected },
    memoryError,
  }
}

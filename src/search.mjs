import { accountCheck, parse } from './check.mjs'
import { latestCheckpoint, recentWrite, MEMWAL } from './sui.mjs'
import { scrub, limitText } from './scrub.mjs'
import { getStore, shareable } from './db.mjs'
import * as memory from './memory.mjs'
import { SURE_DISTANCE, MAX_DISTANCE } from './memory.mjs'

const TOKEN = /\b(?:[1-5]\d\d|[A-Za-z]+[A-Z0-9][A-Za-z0-9_]*|[a-z]+_[a-z_]+)\b/g
// Paths, line:column numbers, hex IDs and UUIDs in stack traces matched unrelated fixes in testing
const NOISE = /\S*\/\S*|:\d+(?::\d+)?\b|\b(?:0x)?[0-9a-f]{8,}\b|\b[0-9a-f-]{36}\b/gi
// Words nearly every Walrus Memory error shares are not evidence of the same error
const COMMON = /^(?:memwal|walrus|id|error|typeerror|api|sdk|http|https|json|url|mcp|ts|js|node_modules|traceid|mainnet)$/i
const STOP = new Set('when with from that this have does after into your will just still every then only same than what about before error memory walrus memwal'.split(' '))
const tokens = (text) => new Set((text.replace(NOISE, ' ').match(TOKEN) ?? []).filter((token) => !COMMON.test(token)).map((token) => token.toLowerCase()))
const sharesToken = (a, b) => [...tokens(a)].some((token) => tokens(b).has(token))
const words = (text) => new Set((text.replace(NOISE, ' ').toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []).filter((word) => !STOP.has(word)))
// Share of the fix's own title and error words that the question also uses
function overlap(text, fix) {
  const own = words(`${fix.title} ${fix.error}`)
  if (own.size < 3) return 0
  const asked = words(text)
  return [...own].filter((word) => asked.has(word)).length / own.size
}
const OVERLAP = 0.5
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
  // Closeness alone matched unrelated errors in testing: every answer also needs a shared error token or most of the fix's words
  const candidates = hits.map((hit) => ({ ...hit, fix: store.fix(hit.id) })).map((hit) => hit.fix && ({
    ...hit, shares: sharesToken(clean, hit.fix.error), overlap: overlap(clean, hit.fix),
  })).filter((hit) => hit && shareable(hit.fix) && hit.distance < MAX_DISTANCE && (hit.shares || hit.overlap >= OVERLAP) && relevant(hit.fix, finding, clean))
  // A closer retired fix still wins: it says which release fixed the error
  candidates.sort((a, b) =>
    Number(Boolean(finding?.verify) && kind(b.fix.verify_fn) === kind(finding.verify)) - Number(Boolean(finding?.verify) && kind(a.fix.verify_fn) === kind(finding.verify)) || a.distance - b.distance)
  const hit = candidates[0]
  const fix = hit?.fix ?? null
  // Sure needs a close match plus strong text evidence, or the account check diagnosing the function the fix names
  const confirmed = Boolean(hit && finding?.verify) && kind(hit.fix.verify_fn) === kind(finding.verify)
  const possible = Boolean(hit) && !(hit.distance < SURE_DISTANCE && (confirmed || hit.overlap >= OVERLAP || (hit.shares && hit.overlap >= OVERLAP / 2)))
  const owner = result.owner ?? null
  let atCheckpoint = null
  let watching = null
  if (!example && clean && fix?.status === 'active' && fix.verify_fn && !possible && owner && start != null && !result.chainError &&
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
  const question = canRecord ? store.addQuestion({ error: clean, owner, checkpoint: atCheckpoint ?? (result.chainError ? null : start), fix_id: fix?.id ?? null,
    delegate_key: result.delegateKey ?? null, watch_state: watching ? 'watching' : 'stopped',
    answered_from: answeredFrom, state: answeredFrom === 'none' ? 'handed_off' : 'answered', created_at: createdAt }) : null
  return {
    ...result, finding,
    fix: fix ? { id: fix.id, title: fix.title, body: fix.body, verify_fn: fix.verify_fn, status: fix.status,
      retiredReason: fix.retired_reason, verified: fix.verified, reported: fix.reported, sourceUrl: fix.source_url, agent: Boolean(fix.caller),
      possible } : null,
    questionId: question?.id ?? null,
    handedOff: question?.state === 'handed_off',
    watching,
    memory: { connected },
    memoryError,
  }
}

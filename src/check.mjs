// The account check: what Sui says about the IDs and transactions in an error.
import { MEMWAL_ABORTS } from './aborts.mjs'
import { MEMWAL, accountOfOwner, callsAfter, readObject, readTransaction } from './sui.mjs'
import { scrub } from './scrub.mjs'

const KEY_LIMIT = 20
const explorer = (kind, id) => `https://suiscan.xyz/mainnet/${kind}/${id}`
const short = (id) => `${id.slice(0, 6)}…${id.slice(-4)}`

export const normalizeKey = (key) => /^(?:0x)?[a-f0-9]{64}$/i.test(key)
  ? key.replace(/^0x/i, '').toLowerCase() : Buffer.from(key, 'base64').toString('hex')

export function parse(text) {
  const prefixedKeys = [...text.matchAll(/(?:delegate(?: public)?|public|key)\s*(?:key)?\s*[:=]?\s*(0x[0-9a-f]{64})\b/gi)].map((m) => m[1])
  text = prefixedKeys.reduce((out, k) => out.replace(k, ' '), text)
  const base64Keys = text.match(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{43}=/g) ?? []
  const rest = base64Keys.reduce((out, k) => out.replace(k, ' '), text)
  const ids = rest.match(/\b0x[0-9a-fA-F]{64}\b/g) ?? []
  const hexKeys = rest.replace(/0x[0-9a-fA-F]{64}/g, ' ').match(/\b[0-9a-fA-F]{64}\b/g) ?? []
  const digests = rest.match(/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g) ?? []
  return {
    ids: [...new Set(ids.map((i) => i.toLowerCase()))].slice(0, 5),
    keys: [...new Set([...base64Keys, ...hexKeys, ...prefixedKeys].map(normalizeKey))].slice(0, 5),
    digests: [...new Set(digests)].slice(0, 2),
  }
}

const isAccount = (o) => o?.type?.endsWith('::account::MemWalAccount')

async function resolveAccount(ids, { readObject, accountOfOwner }) {
  const unknown = []
  const notes = []
  let account = null
  let owner = null

  for (const id of ids) {
    if (id === MEMWAL.testnetPackage || id === MEMWAL.testnetRegistry) {
      notes.push({ id, onMainnet: false, what: id === MEMWAL.testnetPackage ? "Walrus Memory's Testnet package" : "Walrus Memory's Testnet registry" })
      continue
    }
    const object = await readObject(id)
    if (isAccount(object)) account = object.json
    else if (id === MEMWAL.package || id === MEMWAL.registry) notes.push({ id, onMainnet: true, what: id === MEMWAL.package ? "Walrus Memory's Mainnet package" : "Walrus Memory's Mainnet registry" })
    else if (object) notes.push({ id, onMainnet: true, what: object.kind === 'package' ? 'A package on Mainnet' : 'An object on Mainnet' })
    else unknown.push(id)
  }

  // An ID with no object is probably an address, so look for an account owned by it
  for (const id of unknown) {
    if (account) break
    const accountId = await accountOfOwner(id)
    if (accountId) {
      account = (await readObject(accountId))?.json
      owner = id
    }
  }
  return { account, notes, owner: account?.owner ?? owner ?? unknown[0] ?? null, lookedUp: unknown.length > 0 }
}

function accountChecks(account, keys, lookedUp) {
  const checks = []
  if (!account) {
    if (lookedUp) checks.push({ label: 'Account', value: 'No Walrus Memory account for this address', tone: 'bad' })
    return checks
  }
  const frozen = !account.active
  checks.push({
    label: 'Account',
    value: account.admin_quarantined ? 'Quarantined' : frozen ? 'Frozen' : 'Active',
    tone: frozen ? 'bad' : 'good',
    href: explorer('object', account.id),
  })
  const used = account.delegate_keys.length
  checks.push({ label: 'Delegate keys', value: `${used} of ${KEY_LIMIT}`, tone: used >= KEY_LIMIT ? 'bad' : 'plain' })
  if (keys.length) {
    const known = account.delegate_keys.find((k) => keys.includes(normalizeKey(k.public_key)))
    if (known) checks.push({ label: 'This key', value: `Registered as "${known.label}"`, tone: 'good' })
    else checks.push({ label: 'This key', value: 'Not registered', tone: 'bad' })
  }
  return checks
}

// What the chain alone can tell us, from Walrus's docs. Memory adds what other developers found.
function docsAnswer({ account, checks, transaction, notes, lookedUp }) {
  const wrongNetwork = notes.find((n) => !n.onMainnet)
  if (wrongNetwork) return { text: `${wrongNetwork.what} isn't on Mainnet. Use the Mainnet IDs from Walrus's contract docs.`, verify: null }
  const abort = transaction?.abort
  if (abort && transaction.call?.package === MEMWAL.package && transaction.call.module === 'account') {
    const entry = MEMWAL_ABORTS[abort.code]
    if (entry) return { text: entry[1], name: entry[0], verify: transaction.call.function }
  }
  if (lookedUp && !account) return { text: 'This address has no Walrus Memory account yet. Create one at memory.walrus.xyz, then try again.', verify: 'create_account' }
  if (account && !account.active) return { text: 'The account is frozen, so every key is denied. The owner can reactivate it from the dashboard.', verify: 'reactivate_account' }
  if (checks.some((c) => c.label === 'This key' && c.tone === 'bad')) return { text: 'This key is not on your account, so the relayer rejects it. Register it from the dashboard or with addDelegateKey, then retry.', verify: 'add_delegate_key' }
  if (account?.delegate_keys.length >= KEY_LIMIT) return { text: 'The account has reached its limit of 20 delegate keys. Remove one you no longer use, then add the new one.', verify: 'remove_delegate_key' }
  return null
}

export async function accountCheck(text, extra = '', deps = {}) {
  const reads = { readObject, accountOfOwner, readTransaction, callsAfter, ...deps }
  const { ids, keys, digests } = parse(`${scrub(text)}\n${scrub(extra, { publicKeys: true })}`)
  const out = { checks: [], transaction: null, retry: null, answer: null, owner: null, chainError: null, nothingToCheck: false }
  out.delegateKey = keys[0] ?? null
  out.asked = keys.length > 0
  if (!ids.length && !digests.length) return { ...out, nothingToCheck: true }

  try {
    for (const digest of digests.slice(0, 2)) {
      const tx = await reads.readTransaction(digest)
      if (tx) {
        out.transaction = tx
        break
      }
    }

    const tx = out.transaction
    if (tx) {
      const fn = tx.call ? `${tx.call.package}::${tx.call.module}::${tx.call.function}` : null
      if (!tx.ok && fn) {
        const later = await reads.callsAfter({ sender: tx.sender, fn, afterCheckpoint: tx.checkpoint, first: 1 })
        out.retry = later[0] ?? null
      }
      const named = tx.abort && tx.call?.package === MEMWAL.package && tx.call.module === 'account' ? MEMWAL_ABORTS[tx.abort.code]?.[0] : tx.abort?.name
      out.transaction = { ...tx, abortName: named ?? null, href: explorer('tx', tx.digest) }
      if (out.retry) out.retry.href = explorer('tx', out.retry.digest)
    }

    const { account, notes, lookedUp, owner } = await resolveAccount(ids, reads)
    out.owner = owner
    out.hasAccount = Boolean(account)
    out.checks.push(...accountChecks(account, keys, lookedUp))
    for (const n of notes) {
      out.checks.push({ label: short(n.id), value: n.onMainnet ? n.what : `${n.what}, not on Mainnet`, tone: n.onMainnet ? 'good' : 'bad', href: n.onMainnet ? explorer('object', n.id) : undefined })
    }
    out.answer = docsAnswer({ account, checks: out.checks, transaction: out.transaction, notes, lookedUp })
    if (out.answer) out.answer.owner = out.owner
  } catch (error) {
    out.chainError = error.code === 'BUSY' ? 'Tatum is busy. Try again shortly.' : 'Account check unavailable'
  }
  return out
}

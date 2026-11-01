// Sui Mainnet reads through Tatum's gateway. It serves GraphQL; JSON-RPC returns 404 there.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const GATEWAY = 'https://sui-mainnet.gateway.tatum.io/graphql'
const key = () => process.env.TATUM_API_KEY ?? readFileSync(join(homedir(), '.tatum-key'), 'utf8').trim()

export const MEMWAL = {
  package: '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5',
  registry: '0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f',
  accounts: '0xcfe04623a8c72ede45fc02babcb9711625df8549e53d3107d507efa696d5efde',
  testnetPackage: '0x0a625e2db2af6f591a4c80a3d8551ddf11656089cc3a20c5e9e7f8fb75b9265c',
  testnetRegistry: '0x736aef9906798fca4460490ccdf8e8502ef170122dc26ecae32111b78c6b42dd',
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

const requests = new AsyncLocalStorage()
export const withSignal = (signal, run) => requests.run(signal, run)

export function createPacer({ limit = 12, sleep = wait } = {}) {
  let line = Promise.resolve()
  let pending = 0
  return (call, signal) => {
    if (pending >= limit) return Promise.reject(Object.assign(new Error('Tatum is busy. Try again shortly.'), { code: 'BUSY' }))
    pending += 1
    const run = line.then(() => {
      signal?.throwIfAborted()
      return call()
    })
    line = run.catch(() => {}).then(() => sleep(450)).finally(() => { pending -= 1 })
    return run
  }
}
const paced = createPacer()

async function post(body, tries = 3) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key() },
    body,
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...[requests.getStore()].filter(Boolean)]),
  })
  if (res.status === 429 && tries > 1) {
    await wait(1200)
    return post(body, tries - 1)
  }
  if (!res.ok) throw new Error(`Tatum returned ${res.status}`)
  return res.json()
}

async function query(text, variables) {
  const { data, errors } = await paced(() => post(JSON.stringify({ query: text, variables })), requests.getStore())
  if (errors) throw new Error(errors[0].message)
  return data
}

export async function latestCheckpoint() {
  const { checkpoint } = await query('{ checkpoint { sequenceNumber } }')
  return checkpoint.sequenceNumber
}

export async function readObject(id) {
  const { object, package: pkg } = await query(
    `query($a: SuiAddress!) {
      object(address: $a) { asMoveObject { contents { type { repr } json } } }
      package(address: $a) { version }
    }`,
    { a: id },
  )
  if (pkg) return { kind: 'package', version: pkg.version }
  if (!object) return null
  const contents = object.asMoveObject?.contents
  return { kind: 'object', type: contents?.type?.repr ?? '', json: contents?.json ?? null }
}

// The registry maps an owner address to its account, in a table keyed by the address's bytes
export async function accountOfOwner(owner) {
  const bcs = Buffer.from(owner.slice(2), 'hex').toString('base64')
  const { address } = await query(
    `query($t: SuiAddress!, $n: DynamicFieldName!) {
      address(address: $t) { dynamicField(name: $n) { value { ... on MoveValue { json } } } }
    }`,
    { t: MEMWAL.accounts, n: { type: 'address', bcs } },
  )
  return address?.dynamicField?.value?.json ?? null
}

const TX_FIELDS = `
  digest
  sender { address }
  effects {
    status
    timestamp
    checkpoint { sequenceNumber }
    executionError { abortCode identifier constant message module { name package { address } } function { name } }
  }
  kind { ... on ProgrammableTransaction { commands(first: 12) { nodes {
    ... on MoveCallCommand { function { name module { name package { address } } } }
  } } } }`

export function shapeTx(tx) {
  const { effects } = tx
  const calls = (tx.kind?.commands?.nodes ?? [])
    .filter((c) => c.function)
    .map((c) => ({ package: c.function.module.package.address, module: c.function.module.name, function: c.function.name }))
  const error = effects.executionError
  const failed = error?.function
    ? calls.find((c) => c.function === error.function.name && c.module === error.module?.name && c.package === error.module?.package?.address)
    : null
  return {
    digest: tx.digest,
    ok: effects.status === 'SUCCESS',
    sender: tx.sender?.address ?? null,
    timestamp: effects.timestamp,
    checkpoint: effects.checkpoint.sequenceNumber,
    call: effects.status === 'SUCCESS' ? calls[0] ?? null : failed ?? null,
    abort: error ? { code: error.abortCode, name: error.constant ?? error.identifier ?? null, message: error.message } : null,
  }
}

export async function readTransaction(digest) {
  const { transaction } = await query(
    `query($d: String!) { transaction(digest: $d) { ${TX_FIELDS} } }`,
    { d: digest },
  )
  return transaction?.effects ? shapeTx(transaction) : null
}

// Read each first call in order, stopping once every grouped question has a next call.
export async function callsAfter({ sender, fn, afterCheckpoint, throughCheckpoint = afterCheckpoint, first = 1 }) {
  let cursor = null
  const calls = []
  do {
    const { transactions } = await query(
      `query($f: TransactionFilter, $n: Int, $c: String) {
        transactions(first: $n, after: $c, filter: $f) {
          nodes { ${TX_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { f: { sentAddress: sender, function: fn, afterCheckpoint: Number(afterCheckpoint) }, n: first, c: cursor },
    )
    calls.push(...transactions.nodes.map(shapeTx))
    if (calls.some((tx) => BigInt(tx.checkpoint) > BigInt(throughCheckpoint)) || !transactions.pageInfo.hasNextPage) break
    cursor = transactions.pageInfo.endCursor
  } while (cursor)
  return calls
}

const BLOB_CONTENTS = 'contents { type { repr } json }'
const FIELDS = `dynamicFields(first: 5) { nodes { name { json } value { ... on MoveValue { json } } } }`
const OWNER = 'owner { ... on AddressOwner { address { address } } }'
const CHANGES = `objectChanges(first: 100) { nodes { address idCreated inputState { ${OWNER} } outputState {
  asMoveObject { ${BLOB_CONTENTS} } ${OWNER}
} } pageInfo { hasNextPage } }`

export function metadata(object) {
  const field = object?.dynamicFields?.nodes?.find((f) => f.value?.json?.metadata?.contents)
  return Object.fromEntries((field?.value.json.metadata.contents ?? []).map(({ key, value }) => [key, value]))
}

export function blobId(value) {
  if (value == null) return null
  if (!/^\d+$/.test(String(value))) return String(value)
  let number = BigInt(value)
  const bytes = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(number & 255n)
    number >>= 8n
  }
  return bytes.toString('base64url')
}

export async function blobMetadata(id) {
  const { object } = await query(`query($a: SuiAddress!) { object(address: $a) { ${FIELDS} } }`, { a: id })
  return metadata(object)
}

// The relayer registers a Blob first and transfers it later, so what counts is arrival, not creation
async function receivedBlobs(tx, owner) {
  if (tx.effects.objectChanges.pageInfo?.hasNextPage) throw new Error('Too many object changes to check')
  const blobs = []
  for (const change of tx.effects.objectChanges.nodes) {
    const state = change.outputState
    if (change.inputState?.owner?.address?.address === owner || state?.owner?.address?.address !== owner || !state.asMoveObject?.contents?.type?.repr.endsWith('::blob::Blob')) continue
    const meta = await blobMetadata(change.address)
    if (meta.memwal_owner !== owner || !meta.memwal_namespace || !meta.memwal_agent_id || !meta.memwal_package_id) continue
    blobs.push({ objectId: change.address, agentId: meta.memwal_agent_id, metadata: meta })
  }
  return { digest: tx.digest, ok: tx.effects.status === 'SUCCESS', checkpoint: tx.effects.checkpoint.sequenceNumber,
    timestamp: tx.effects.timestamp, owner, blobs }
}

async function scanBlobs({ owner, afterCheckpoint, throughCheckpoint = afterCheckpoint, since, until }) {
  let cursor = null
  const writes = []
  let pages = 0
  do {
    if (++pages > 10) throw new Error('Too many transactions to check')
    const backwards = since != null
    const { transactions } = await query(`query($f: TransactionFilter, $c: String) {
      transactions(${backwards ? 'last: 20, before' : 'first: 20, after'}: $c, filter: $f) {
        nodes { digest effects { status timestamp checkpoint { sequenceNumber } ${CHANGES} } }
        pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
      }
    }`, { f: { affectedAddress: owner, ...(afterCheckpoint == null ? {} : { afterCheckpoint: Number(afterCheckpoint) }) }, c: cursor })
    for (const tx of transactions.nodes) {
      if (since != null && (Date.parse(tx.effects.timestamp) < since || Date.parse(tx.effects.timestamp) > until)) continue
      const write = await receivedBlobs(tx, owner)
      if (write.blobs.length) writes.push(write)
    }
    if (backwards && (writes.length || transactions.nodes.some((tx) => Date.parse(tx.effects.timestamp) < since))) break
    if (!backwards && writes.some((tx) => BigInt(tx.checkpoint) > BigInt(throughCheckpoint))) break
    const page = transactions.pageInfo
    if (!(backwards ? page.hasPreviousPage : page.hasNextPage)) break
    cursor = backwards ? page.startCursor : page.endCursor
  } while (cursor)
  return writes
}

export const writesAfter = (options) => scanBlobs(options)
export const recentWrite = async (owner, at) => (await scanBlobs({ owner, since: at - 15 * 60000, until: at })).some((tx) => Date.parse(tx.timestamp) <= at)

// Each object's metadata counts as a backing query, and Sui allows 21 per request, so pages stay small
export async function ownedBlobs(owner, namespace = 'fixes') {
  const blobs = []
  let cursor = null
  do {
    const { address } = await query(`query($a: SuiAddress!, $c: String) {
      address(address: $a) { objects(first: 15, after: $c) {
        nodes { address ${BLOB_CONTENTS} ${FIELDS} }
        pageInfo { hasNextPage endCursor }
      } }
    }`, { a: owner, c: cursor })
    for (const object of address.objects.nodes) {
      const { contents } = object
      const meta = metadata(object)
      if (contents?.type?.repr.endsWith('::blob::Blob') && meta.memwal_owner === owner && meta.memwal_namespace === namespace) {
        blobs.push({ objectId: object.address, blobId: blobId(contents.json.blob_id) })
      }
    }
    if (!address.objects.pageInfo.hasNextPage) break
    cursor = address.objects.pageInfo.endCursor
  } while (cursor)
  return blobs
}

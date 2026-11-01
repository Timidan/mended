// Sui Mainnet reads through Tatum's gateway. It serves GraphQL; JSON-RPC returns 404 there.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

// ponytail: one call at a time at the free plan's pace; a paid Tatum plan can shorten GAP_MS
const GAP_MS = 450
let line = Promise.resolve()
function paced(call) {
  const run = line.then(call)
  line = run.catch(() => {}).then(() => wait(GAP_MS))
  return run
}

async function post(body, tries = 3) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key() },
    body,
    signal: AbortSignal.timeout(20000),
  })
  if (res.status === 429 && tries > 1) {
    await wait(1200)
    return post(body, tries - 1)
  }
  if (!res.ok) throw new Error(`Tatum returned ${res.status}`)
  return res.json()
}

async function query(text, variables) {
  const { data, errors } = await paced(() => post(JSON.stringify({ query: text, variables })))
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
    executionError { abortCode identifier constant message module { name } function { name } }
  }
  kind { ... on ProgrammableTransaction { commands(first: 12) { nodes {
    ... on MoveCallCommand { function { name module { name package { address } } } }
  } } } }`

function shapeTx(tx) {
  const { effects } = tx
  const calls = (tx.kind?.commands?.nodes ?? [])
    .filter((c) => c.function)
    .map((c) => ({ package: c.function.module.package.address, module: c.function.module.name, function: c.function.name }))
  const error = effects.executionError
  const failed = error?.function
    ? calls.find((c) => c.function === error.function.name && c.module === error.module?.name)
    : null
  return {
    digest: tx.digest,
    ok: effects.status === 'SUCCESS',
    sender: tx.sender?.address ?? null,
    timestamp: effects.timestamp,
    checkpoint: effects.checkpoint.sequenceNumber,
    call: failed ?? calls[0] ?? null,
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

// The first transactions from `sender` that call `fn` after a checkpoint. This is how a fix gets proven.
export async function callsAfter({ sender, fn, afterCheckpoint, first = 5, untilSuccess = false }) {
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
    if (!untilSuccess || calls.some((tx) => tx.ok) || !transactions.pageInfo.hasNextPage) break
    cursor = transactions.pageInfo.endCursor
  } while (cursor)
  return calls
}

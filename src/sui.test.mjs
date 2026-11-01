import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callsAfter, createPacer, shapeTx, writesAfter, recentWrite, ownedBlobs, blobId } from './sui.mjs'

process.env.TATUM_API_KEY = 'unused-in-this-test'

test('contract reads request the first call and retain a failure', async (t) => {
  let reads = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { variables } = JSON.parse(options.body)
    assert.equal(variables.n, 1)
    reads += 1
    return { ok: true, json: async () => ({ data: { transactions: {
      nodes: [{ digest: 'failed', sender: { address: 'owner' }, effects: { status: 'FAILURE',
        timestamp: '2026-11-01T12:00:00Z', checkpoint: { sequenceNumber: '101' } } }],
      pageInfo: { hasNextPage: true, endCursor: 'more' },
    } } }) }
  })
  const calls = await callsAfter({ sender: 'owner', fn: 'package::account::register', afterCheckpoint: '100' })
  assert.equal(reads, 1)
  assert.equal(calls[0].ok, false)
})

test('the paced queue rejects excess work and cancels disconnected work', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const pace = createPacer({ limit: 2, sleep: async () => {} })
  const a = pace(() => blocked)
  const abort = new AbortController()
  const b = pace(() => assert.fail('disconnected work ran'), abort.signal)
  await assert.rejects(pace(() => {}), /busy/)
  abort.abort()
  release()
  await a
  await assert.rejects(b, /aborted/)
})

test('an unmatched failing call never falls back to the first command', () => {
  const tx = { effects: { status: 'FAILURE', checkpoint: { sequenceNumber: '1' }, executionError: { abortCode: 1, function: { name: 'missing' }, module: { name: 'account', package: { address: 'pkg' } } } },
    kind: { commands: { nodes: [{ function: { name: 'add_delegate_key', module: { name: 'account', package: { address: 'pkg' } } } }] } } }
  assert.equal(shapeTx(tx).call, null)
  tx.effects.executionError.function.name = 'add_delegate_key'
  assert.equal(shapeTx(tx).call.function, 'add_delegate_key')
})

test('relayer-created Blobs use affected owner and metadata, and list links by blob ID', async (t) => {
  const owner = 'owner'
  // Shape read from a real Blob on Mainnet: the field name is base64 and the entries sit under metadata
  const fields = { nodes: [{ name: { json: 'bWV0YWRhdGE=' }, value: { json: { metadata: { contents: [
    { key: 'memwal_owner', value: owner }, { key: 'memwal_namespace', value: 'fixes' },
    { key: 'memwal_agent_id', value: 'ab'.repeat(32) }, { key: 'memwal_package_id', value: 'pkg' },
  ] } } } }] }
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    let data
    if (query.includes('transactions(')) {
      assert.equal(variables.f.affectedAddress, owner)
      assert.equal(variables.f.sentAddress, undefined)
      data = { transactions: { nodes: [{ digest: 'relayed', effects: { status: 'SUCCESS', timestamp: '2026-11-01T12:00:00Z',
        checkpoint: { sequenceNumber: '101' }, objectChanges: { nodes: [{ address: 'object-one', idCreated: true,
          outputState: { asMoveObject: { contents: { type: { repr: 'pkg::blob::Blob' } } }, owner: { address: { address: owner } } } }], pageInfo: { hasNextPage: false } } } }], pageInfo: {} } }
    } else if (query.includes('objects(')) {
      data = { address: { objects: { nodes: [{ address: 'object-one', dynamicFields: fields,
        contents: { type: { repr: 'pkg::blob::Blob' }, json: { blob_id: '1' } } }], pageInfo: {} } } }
    } else data = { object: { dynamicFields: fields } }
    return { ok: true, json: async () => ({ data }) }
  })
  const writes = await writesAfter({ owner, afterCheckpoint: '100' })
  assert.equal(writes[0].blobs[0].agentId, 'ab'.repeat(32))
  assert.equal(await recentWrite(owner, Date.parse('2026-11-01T12:01:00Z')), true)
  assert.deepEqual(await ownedBlobs(owner), [{ objectId: 'object-one', blobId: blobId('1') }])
  assert.equal(Buffer.from(blobId('1'), 'base64url')[0], 1)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callsAfter } from './sui.mjs'

test('watching continues past a page of failures to the next success', async (t) => {
  process.env.TATUM_API_KEY = 'unused-in-this-test'
  let pages = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { variables } = JSON.parse(options.body)
    assert.equal(variables.c, pages ? 'next-page' : null)
    pages += 1
    return { ok: true, json: async () => ({ data: { transactions: {
      nodes: [{ digest: `tx-${pages}`, sender: { address: 'owner' }, effects: { status: pages === 2 ? 'SUCCESS' : 'FAILURE',
        timestamp: '2026-11-01T12:00:00Z', checkpoint: { sequenceNumber: '101' } } }],
      pageInfo: { hasNextPage: pages === 1, endCursor: pages === 1 ? 'next-page' : null },
    } } }) }
  })
  const calls = await callsAfter({ sender: 'owner', fn: 'package::account::register', afterCheckpoint: '100', untilSuccess: true })
  assert.equal(pages, 2)
  assert.equal(calls.find((tx) => tx.ok).digest, 'tx-2')
})

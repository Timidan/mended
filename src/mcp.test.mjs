import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleMcp } from './mcp.mjs'

test('MCP negotiates a supported version, validates tools and wraps failures', async () => {
  const call = (method, params, ask) => handleMcp({ jsonrpc: '2.0', id: 1, method, params }, ask)
  assert.equal((await call('initialize', { protocolVersion: 'future' })).result.protocolVersion, '2025-06-18')
  assert.equal((await call('tools/call', { name: 'other' })).error.code, -32602)
  assert.equal((await call('tools/call', { name: 'search_fixes', arguments: { error: {} } })).error.code, -32602)
  assert.equal((await call('tools/call', { name: 'search_fixes', arguments: { error: 'Error' } }, async () => { throw new Error('private detail') })).error.code, -32603)
  const result = await call('tools/call', { name: 'search_fixes', arguments: { error: 'Error' } }, async () => ({ finding: { text: 'Chain finding' }, fix: { title: 'Fix', body: 'Advice' } }))
  assert.match(result.result.content[0].text, /^Walrus docs: Chain finding/)
})

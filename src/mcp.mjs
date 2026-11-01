// A minimal MCP endpoint over HTTP, with one tool that runs the same search as the website.
import { searchFixes } from './search.mjs'

const VERSION = '2025-06-18'

const TOOL = {
  name: 'search_fixes',
  description: 'Call this when a Walrus Memory or Sui call fails. Send the error text and any public IDs. Returns an on-chain check of the account and fixes that worked for other developers. Never send private keys.',
  annotations: { title: 'Search fixes', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      error: { type: 'string', description: 'The error message, or a Sui transaction digest' },
      address: { type: 'string', description: 'Sui address, Walrus Memory account ID or delegate public key, if known' },
    },
    required: ['error'],
  },
}

function asText(r) {
  const out = []
  if (r.finding) out.push(`Walrus docs: ${r.finding.text}`)
  if (r.fix) out.push(`${r.fix.status === 'retired' ? `Retired: ${r.fix.retiredReason?.toLowerCase()}. ` : r.fix.possible ? 'Possible match: ' : ''}${r.fix.title}\n${r.fix.body}\nVerified: ${r.fix.verified}. Reported: ${r.fix.reported}.${r.fix.sourceUrl ? `\nSource: ${r.fix.sourceUrl}` : ''}`)
  if (r.chainError) out.push(`Could not read Sui through Tatum: ${r.chainError}`)
  if (r.memoryError) out.push(r.memoryError)
  else if (r.memory?.connected === false) out.push('Walrus Memory is not connected.')
  if (r.nothingToCheck) out.push('No address, account ID or transaction in that error. Send the Sui address or account ID to get an on-chain check.')
  if (r.handedOff) out.push('Sent for a person to answer.')
  if (r.watching) out.push(`Watching ${r.watching} for a successful call on Sui for up to 7 days.`)
  if (r.questionId) out.push(`Question: ${r.questionId}`)
  if (r.transaction) {
    const t = r.transaction
    out.push(`Transaction ${t.digest}: ${t.ok ? 'succeeded' : 'failed'}${t.abortName ? `, ${t.abortName}` : ''}${t.abort ? ` (abort code ${t.abort.code})` : ''}`)
  }
  if (r.retry) out.push(`The sender's next call ${r.retry.ok ? 'succeeded' : 'failed'}: ${r.retry.digest}`)
  for (const c of r.checks ?? []) out.push(`${c.label}: ${c.value}`)
  return out.join('\n') || 'No fix found for this error yet.'
}

export async function handleMcp(message, ask = searchFixes) {
  const { id, method, params } = message
  const reply = (result) => ({ jsonrpc: '2.0', id, result })
  if (id === undefined) return null // a notification needs no answer
  if (method === 'initialize') {
    return reply({
      protocolVersion: VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'mended', version: '0.1.0' },
    })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: [TOOL] })
  if (method === 'tools/call') {
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
    if (params?.name !== TOOL.name) return fail(-32602, 'Unknown tool')
    const { error, address = '' } = params.arguments ?? {}
    if (typeof error !== 'string' || !error.trim() || Buffer.byteLength(error) > 16000 || typeof address !== 'string' || address.length > 2000) {
      return fail(-32602, 'Send error text and an optional public address.')
    }
    try {
      return reply({ content: [{ type: 'text', text: asText(await ask(error, address)) }] })
    } catch {
      return fail(-32603, 'Unable to search. Try again shortly.')
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } }
}

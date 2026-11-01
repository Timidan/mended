import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { searchFixes } from './search.mjs'
import { handleMcp } from './mcp.mjs'
import { getStore } from './db.mjs'
import * as memory from './memory.mjs'
import { scrub } from './scrub.mjs'
import { MEMWAL } from './sui.mjs'
import { startWatcher } from './watcher.mjs'
import { startRetiring } from './retire.mjs'

const ROOT = join(import.meta.dirname, '..', 'public')
const PAGES = { '/': 'index.html', '/search': 'search.html', '/fixes': 'fixes.html', '/answer': 'answer.html' }
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }
const PRIVATE = new Set(['/answer', '/answer.html', '/answer.js', '/api/answer'])
const MAX_BODY = 16_000

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function serveFile(res, path) {
  const file = normalize(join(ROOT, PAGES[path] ?? path))
  if (!file.startsWith(`${ROOT}${sep}`)) return send(res, 403, 'Forbidden')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    send(res, 404, 'Not found')
  }
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('too long')
  }
  const body = JSON.parse(raw)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
  return body
}

function authorized(req, token) {
  const header = req.headers.authorization ?? ''
  let supplied = ''
  if (header.startsWith('Bearer ')) supplied = header.slice(7)
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    supplied = decoded.slice(decoded.indexOf(':') + 1)
  }
  const a = Buffer.from(supplied)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function answerFields(body) {
  const title = scrub(String(body.title ?? '').trim())
  const text = scrub(String(body.body ?? '').trim())
  const fn = String(body.verify_fn ?? '').trim().replace(`${MEMWAL.package}::`, '') || null
  const source = String(body.source_url ?? '').trim() || null
  if (!title || !text) throw new Error('Add a title and a fix.')
  if (fn && !/^(?:[a-zA-Z_]\w*::)?[a-zA-Z_]\w*$/.test(fn)) throw new Error('Use a function name or module::function.')
  if (source) {
    const url = new URL(source)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public source URL.')
  }
  return { title, body: text, verify_fn: fn, source_url: source ? scrub(source) : null,
    sdk_version: scrub(String(body.sdk_version ?? '').trim()) || null,
    retire_at_version: scrub(String(body.retire_at_version ?? '').trim()) || null }
}

export function createApp({ store = getStore(), search = searchFixes, memories = memory, adminToken = process.env.ADMIN_TOKEN } = {}) {
  const asks = new Map()
  function overLimit(req) {
    // The proxy appends the real caller last; anything earlier in the header is client-supplied
    const ip = req.headers['cf-connecting-ip'] ?? String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',').at(-1).trim()
    const minute = Math.floor(Date.now() / 60000)
    if (asks.size > 10_000) asks.clear()
    if (asks.get(ip)?.minute !== minute) asks.set(ip, { minute, count: 0 })
    const entry = asks.get(ip)
    return ++entry.count > 20
  }

  async function route(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname
    if (PRIVATE.has(path)) {
      res.setHeader('cache-control', 'no-store')
      if (!adminToken) return send(res, 404, 'Not found')
      if (!authorized(req, adminToken)) {
        res.setHeader('www-authenticate', 'Basic realm="Mended answers", charset="UTF-8"')
        return send(res, 401, 'Use the admin token as your password.')
      }
    }
    if (path === '/api/fixes' && req.method === 'GET') return json(res, 200, { fixes: store.fixes() })
    if (path === '/api/stats' && req.method === 'GET') return json(res, 200, store.stats())
    if (path === '/api/answer' && req.method === 'GET') return json(res, 200, { questions: store.pending() })
    if (['/api/ask', '/api/report', '/api/answer', '/mcp'].includes(path) && req.method === 'POST') {
      if (path !== '/api/answer' && overLimit(req)) return json(res, 429, path === '/mcp'
        ? { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many calls in a minute' } }
        : { error: 'Too many requests. Try again shortly.' })
      let body
      try {
        body = await readJson(req)
      } catch {
        return json(res, 400, path === '/mcp'
          ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not valid JSON' } }
          : { error: 'That was too long or not valid JSON.' })
      }
      if (path === '/mcp') {
        const result = await handleMcp(body, search)
        return result ? json(res, 200, result) : res.writeHead(202).end()
      }
      if (path === '/api/ask') {
        const error = String(body.error ?? '').trim()
        const address = String(body.address ?? '').trim()
        if (!error && !address) return json(res, 400, { error: 'Paste an error first.' })
        return json(res, 200, await search(error, address))
      }
      const questionId = String(body.questionId ?? '')
      if (path === '/api/report') {
        const fix = store.report(questionId)
        return fix ? json(res, 200, { reported: fix.reported }) : json(res, 404, { error: 'No fix found for this question.' })
      }
      const question = store.question(questionId)
      if (!question) return json(res, 404, { error: 'Question not found.' })
      if (question.state !== 'handed_off' && (!question.fix_id || store.fix(question.fix_id)?.source !== 'person')) {
        return json(res, 409, { error: 'This question already has an answer.' })
      }
      let fix
      try {
        fix = store.answer(questionId, answerFields(body))
      } catch {
        return json(res, 400, { error: 'Add a title, a fix, and valid optional fields.' })
      }
      let memoryError = null
      if (!fix.memory_id) {
        try {
          const id = await memories.remember(fix)
          if (id) store.remember(fix.id, id)
        } catch {
          memoryError = 'Answer saved. Walrus Memory is unavailable. Retry to remember it.'
        }
      }
      return json(res, 200, { fix: store.fix(fix.id), memory: { connected: memories.connected }, memoryError })
    }
    if (path === '/mcp') res.setHeader('allow', 'POST')
    if (path.startsWith('/api/') || path === '/mcp') return send(res, 405, 'Method not allowed')
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed')
    return serveFile(res, path)
  }

  return createServer((req, res) => {
    route(req, res).catch(() => json(res, 500, { error: 'Unable to complete this request. Try again.' }))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4317)
  const server = createApp()
  const watcher = startWatcher()
  const retiring = startRetiring()
  server.on('close', () => {
    clearInterval(watcher)
    clearInterval(retiring)
  })
  server.listen(port, () => console.log(`Mended on http://localhost:${port}`))
}

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual, createHash } from 'node:crypto'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { searchFixes } from './search.mjs'
import { handleMcp } from './mcp.mjs'
import { getStore, shareable } from './db.mjs'
import * as memory from './memory.mjs'
import { answerFields } from './fields.mjs'
import { saveFix } from './save.mjs'
import { withSignal } from './sui.mjs'
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

export function createApp({ store = getStore(), search = searchFixes, memories = memory, adminToken = process.env.ADMIN_TOKEN, now = Date.now, trustCloudflare = process.env.TRUST_CLOUDFLARE === '1' } = {}) {
  const asks = new Map()
  const caller = (req) => trustCloudflare && req.headers['cf-connecting-ip']
    ? req.headers['cf-connecting-ip'] : String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',').at(-1).trim()
  const dailyCaller = (req) => createHash('sha256').update(`${new Date(now()).toISOString().slice(0, 10)}:${caller(req)}`).digest('hex')
  function overLimit(req) {
    // The proxy appends the real caller last; anything earlier in the header is client-supplied
    const ip = caller(req)
    const minute = Math.floor(now() / 60000)
    for (const [key, entry] of asks) if (entry.minute < minute) asks.delete(key)
    if (asks.get(ip)?.minute !== minute) asks.set(ip, { minute, count: 0 })
    const entry = asks.get(ip)
    return ++entry.count > 20
  }

  async function route(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname
    if ((PRIVATE.has(path) || req.method === 'POST') && overLimit(req)) return json(res, 429, path === '/mcp'
      ? { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many calls in a minute' } }
      : { error: 'Too many requests. Try again shortly.' })
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json(res, 415, { error: 'Use application/json.' })
    }
    if (path === '/healthz' && req.method === 'GET') {
      store.db.prepare('SELECT 1').get()
      return json(res, 200, { ok: true })
    }
    if (PRIVATE.has(path)) {
      res.setHeader('cache-control', 'no-store')
      if (!adminToken) return send(res, 404, 'Not found')
      if (!authorized(req, adminToken)) {
        res.setHeader('www-authenticate', 'Basic realm="Mended answers", charset="UTF-8"')
        return send(res, 401, 'Use the admin token as your password.')
      }
    }
    if (path === '/api/fixes' && req.method === 'GET') return json(res, 200, { fixes: store.fixes().filter(shareable).map(({ caller: saved, author, ...fix }) => {
      const { error, ...publicFix } = fix
      return { ...(fix.source === 'person' ? publicFix : fix), agent: Boolean(saved) }
    }) })
    if (path === '/api/stats' && req.method === 'GET') return json(res, 200, store.stats())
    if (path === '/api/answer' && req.method === 'GET') return json(res, 200, { questions: store.pending() })
    if (['/api/ask', '/api/report', '/api/answer', '/mcp'].includes(path) && req.method === 'POST') {
      if (path === '/api/answer') {
        let origin
        try { origin = new URL(req.headers.origin) } catch {}
        if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host || origin.username || origin.password) {
          return json(res, 403, { error: 'Use this site to answer questions.' })
        }
      }
      let body
      try {
        body = await readJson(req)
      } catch {
        return json(res, 400, path === '/mcp'
          ? { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not valid JSON' } }
          : { error: 'That was too long or not valid JSON.' })
      }
      if (path === '/mcp') {
        const result = await handleMcp(body, search, (args) => saveFix(args, { store, caller: dailyCaller(req) }))
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
        const fix = store.report(questionId, dailyCaller(req), new Date(now()).toISOString())
        return fix ? json(res, 200, { reported: fix.reported }) : json(res, 404, { error: 'No fix found for this question.' })
      }
      const question = store.question(questionId)
      if (!question) return json(res, 404, { error: 'Question not found.' })
      if (body.action === 'dismiss') {
        store.dismiss(questionId)
        return json(res, 200, { dismissed: true })
      }
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
      let linkError = null
      if (!fix.memory_id) {
        try {
          const id = await memories.remember(fix)
          if (id) {
            store.remember(fix.id, id)
            if (!id.blob_object_id) linkError = 'Answer remembered. Its Sui object link is not available yet.'
          }
        } catch {
          memoryError = 'Answer saved. Walrus Memory is unavailable. Retry to remember it.'
        }
      }
      return json(res, 200, { fix: store.fix(fix.id), memory: { connected: memories.connected }, memoryError, linkError })
    }
    if (path === '/mcp') res.setHeader('allow', 'POST')
    if (path.startsWith('/api/') || path === '/mcp') return send(res, 405, 'Method not allowed')
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed')
    return serveFile(res, path)
  }

  return createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    const abort = new AbortController()
    req.on('aborted', () => abort.abort())
    res.on?.('close', () => { if (!res.writableEnded) abort.abort() })
    withSignal(abort.signal, () => route(req, res)).catch(() => {
      if (!res.destroyed) json(res, 500, { error: 'Unable to complete this request. Try again.' })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4317)
  const store = getStore()
  const server = createApp({ store })
  const watcher = startWatcher()
  const retiring = startRetiring()
  server.on('close', () => {
    clearInterval(watcher)
    clearInterval(retiring)
  })
  process.once('SIGTERM', () => {
    clearInterval(watcher)
    clearInterval(retiring)
    server.close(() => {
      store.close()
      process.exit(0)
    })
    server.closeIdleConnections()
    setTimeout(() => {
      server.closeAllConnections()
      store.close()
      process.exit(0)
    }, 10000).unref()
  })
  server.listen(port, () => console.log(`Mended on http://localhost:${port}`))
}

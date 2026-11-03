import { scrub, limitText } from './scrub.mjs'
import { MEMWAL } from './sui.mjs'

export function answerFields(body) {
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
  if (typeof body.error !== 'string' || !body.error.trim()) throw new Error('Review the error text.')
  return { error: limitText(scrub(body.error.trim())), title, body: text, verify_fn: fn, source_url: source ? scrub(source) : null,
    sdk_version: scrub(String(body.sdk_version ?? '').trim()) || null,
    retire_at_version: scrub(String(body.retire_at_version ?? '').trim()) || null }
}

// The Walrus relayer sees plaintext, so secrets must never reach memory.
const ordinary = /\b(?:the|and|for|that|this|with|you|your|are|was|from|when|then|error|failed|please|have|will)\b/i
const seed = (run) => ordinary.test(run) ? run : '[possible seed phrase]'
const RULES = [
  [/suiprivkey1[0-9a-z]+/gi, '[sui private key]'],
  [/\bt-[0-9a-f]{20,}-[0-9a-f]{20,}\b/gi, '[Tatum key]'],
  [/\b(?:sk-[\w-]{12,}|ghp_[\w]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[secret]'],
  [/\b(?:bearer|authorization:?)\s+[\w.~+/=-]{12,}/gi, '[authorization header]'],
  [/\b[\w-]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|memwal[_-]?key)[\w-]*["']?\s*[:=]\s*["']?[^\s"',}\]]+/gi, '[secret]'],
  [/\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\b\s+["']?(?=[^\s"',]*\d)[^\s"',]{6,}/gi, '[secret]'],
  [/\b[a-z]+:\/\/[^\s/:@]+:[^\s/@]+@/gi, '[url with password]'],
  [/(?<![0-9a-f])(?:0x)?[0-9a-f]{128}(?![0-9a-f])/gi, '[128-digit hex key]'],
  [/(?<![0-9a-fx])(?:[0-9a-f]{64})(?![0-9a-f])/gi, '[64-digit hex key]'],
  [/\[(?:\s*["'][a-z]{3,8}["']\s*,){11,23}\s*["'][a-z]{3,8}["']\s*\]/gi, seed],
  [/(?:\b\d{1,2}[.):]\s*[a-z]{3,8}[\s,]*){12,24}/gi, seed],
  [/\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi, seed],
]

export const scrub = (text, { publicKeys = false } = {}) => RULES.reduce((out, [rule, label]) =>
  publicKeys && label === '[64-digit hex key]' ? out : out.replace(rule, label), text)
export const limitText = (text) => {
  const bytes = Buffer.from(text)
  return bytes.length <= 4096 ? text : new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4093))
}

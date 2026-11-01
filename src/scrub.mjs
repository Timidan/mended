// The Walrus relayer sees plaintext, so secrets must never reach memory.
const RULES = [
  [/suiprivkey1[0-9a-z]+/gi, '[sui private key]'],
  [/\bt-[0-9a-f]{20,}-[0-9a-f]{20,}\b/gi, '[Tatum key]'],
  [/\b(?:bearer|authorization:?)\s+[\w.~+/=-]{12,}/gi, '[authorization header]'],
  [/\b(?:api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key|mnemonic|seed)\b\s*[:=]\s*["']?[^\s"',]{6,}/gi, '[secret]'],
  [/\b(?:api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key|mnemonic|seed)\b\s+["']?(?=[^\s"',]*\d)[^\s"',]{6,}/gi, '[secret]'],
  [/\b[a-z]+:\/\/[^\s/:@]+:[^\s/@]+@/gi, '[url with password]'],
  [/(?<![0-9a-fx])(?:[0-9a-f]{64})(?![0-9a-f])/gi, '[64-digit hex key]'],
  // ponytail: seed phrases use a fixed word list without these words, so a run containing one is ordinary prose
  [/\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g, (run) => (/\b(?:the|and|for|that|this|with|you|your|are|was|from)\b/.test(run) ? run : '[possible seed phrase]')],
]

export const scrub = (text) => RULES.reduce((out, [rule, label]) => out.replace(rule, label), text)

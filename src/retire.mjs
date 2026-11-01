import { getStore } from './db.mjs'

const parse = (version) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)

export function compareVersions(a, b) {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return null
  for (let i = 1; i <= 3; i++) {
    if (Number(left[i]) !== Number(right[i])) return Math.sign(Number(left[i]) - Number(right[i]))
  }
  if (left[4] === right[4]) return 0
  if (!left[4] || !right[4]) return left[4] ? -1 : 1
  const x = left[4].split('.')
  const y = right[4].split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1
    const xn = /^\d+$/.test(x[i])
    const yn = /^\d+$/.test(y[i])
    if (xn && yn) return Math.sign(Number(x[i]) - Number(y[i]))
    if (xn !== yn) return xn ? -1 : 1
    return x[i] < y[i] ? -1 : 1
  }
  return 0
}

export async function retireFixes({ store = getStore(), fetchVersion = fetch } = {}) {
  try {
    const response = await fetchVersion('https://registry.npmjs.org/@mysten-incubation/memwal/latest', { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return 0
    const { version } = await response.json()
    let retired = 0
    for (const fix of store.fixes()) {
      const order = compareVersions(fix.retire_at_version, version)
      if (fix.status !== 'active' || order === null || order > 0) continue
      retired += Number(store.retire(fix.id, fix.retire_at_version).changes)
    }
    return retired
  } catch {
    return 0
  }
}

export function startRetiring() {
  void retireFixes()
  const timer = setInterval(() => void retireFixes(), 24 * 60 * 60 * 1000)
  timer.unref()
  return timer
}

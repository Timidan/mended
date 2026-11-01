import { MEMWAL, callsAfter } from './sui.mjs'
import { getStore } from './db.mjs'

const WEEK = 7 * 24 * 60 * 60 * 1000

export async function watchQuestions({ store = getStore(), readCalls = callsAfter, now = Date.now() } = {}) {
  const questions = store.watching(new Date(now - WEEK).toISOString())
  let verified = 0
  let failed = 0
  for (const question of questions) {
    const name = question.verify_fn.replace(`${MEMWAL.package}::`, '')
    const fn = `${MEMWAL.package}::${name.includes('::') ? name : `account::${name}`}`
    try {
      const calls = await readCalls({ sender: question.owner, fn, afterCheckpoint: question.checkpoint, first: 50, untilSuccess: true })
      const success = calls.find((tx) => tx.ok && tx.sender === question.owner &&
        BigInt(tx.checkpoint) > BigInt(question.checkpoint) && new Date(tx.timestamp) >= new Date(question.created_at))
      if (success) verified += Number(store.verify(question.id, success.digest, success.timestamp).changes)
    } catch {
      failed += 1
    }
  }
  return { verified, failed }
}

export function startWatcher() {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      const { failed } = await watchQuestions()
      if (failed) console.warn(`Tatum unavailable for ${failed} verification checks`)
    } catch {
      console.warn('Verification check unavailable')
    } finally {
      running = false
    }
  }, 60_000)
  timer.unref()
  return timer
}

// Agents save fixes here. Nothing reaches Walrus Memory or other agents until Sui shows the saving
// address's next write succeeded or a person approves it, because Walrus writes are permanent.
import { answerFields } from './fields.mjs'
import { getStore } from './db.mjs'
import { recentWrite } from './sui.mjs'

const DAILY_LIMIT = 5
const refuse = (message) => Object.assign(new Error(message), { code: 'REFUSED' })

export async function saveFix({ question_id, error, title, fix }, { store = getStore(), caller = 'local', recent = recentWrite } = {}) {
  const question = store.question(String(question_id ?? ''))
  if (!question || question.dismissed) throw refuse('No open question with that ID.')
  if ((question.fix_id && question.answered_from === 'none') || store.wasVerified(question.id)) throw refuse('This question already has an answer.')
  if (store.savedBy(caller) >= DAILY_LIMIT) throw refuse('Daily limit reached. Try again tomorrow.')
  if (String(title ?? '').length > 200 || String(fix ?? '').length > 3000) throw refuse('Keep the title under 200 characters and the fix under 3,000.')
  let fields
  try {
    fields = answerFields({ error, title, body: fix, verify_fn: 'memory_write' })
  } catch {
    throw refuse('Send the error, a title and the fix.')
  }
  const saved = store.saveAgentFix(question.id, { ...fields, caller, author: question.owner })
  let checkable = Boolean(question.owner && question.checkpoint != null)
  if (checkable) {
    // An address that was already writing proves nothing about this fix
    try {
      checkable = !await recent(question.owner, Date.parse(question.created_at))
    } catch {
      checkable = false
    }
  }
  if (checkable) store.watch(question.id)
  return { id: saved.id, watching: checkable ? question.owner : null }
}

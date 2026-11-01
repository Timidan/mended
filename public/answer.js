const box = document.querySelector('#questions')
const status = document.querySelector('#answer-status')

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function questionForm(question) {
  const fields = [
    ['error', 'Error text to publish (redact private details)', 'textarea', true],
    ['title', 'Title', 'input', true], ['body', 'Fix', 'textarea', true],
    ['verify_fn', 'Sui function or memory_write (optional)', 'input', false],
    ['source_url', 'Source URL (optional)', 'input', false],
    ['sdk_version', 'SDK version (optional)', 'input', false],
    ['retire_at_version', 'Retire at SDK version (optional)', 'input', false],
  ]
  const form = el('form', { className: 'answer-form' })
  for (const [name, text, tag, required] of fields) {
    const id = `${question.id}-${name}`
    const input = el(tag, { id, name, required })
    if (name === 'error') input.value = question.error
    if (question.fix) {
      input.value = question.fix[name] ?? ''
      input.readOnly = true
    }
    if (tag === 'textarea') input.rows = 6
    if (name === 'source_url') input.type = 'url'
    form.append(el('label', { htmlFor: id, textContent: text }), input)
  }
  const button = el('button', { className: 'btn solid', type: 'submit', textContent: question.fix ? 'Retry memory write' : 'Save answer' })
  const message = el('p', { role: 'status' })
  const dismiss = el('button', { className: 'btn line', type: 'button', textContent: 'Dismiss question' })
  dismiss.addEventListener('click', async () => {
    if (!confirm('Dismiss this question? It leaves the queue for good.')) return
    dismiss.disabled = true
    try {
      const response = await fetch('/api/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, action: 'dismiss' }),
      })
      if (!response.ok) throw new Error()
      form.closest('section').remove()
    } catch {
      message.textContent = 'Unable to dismiss. Try again.'
      dismiss.disabled = false
    }
  })
  form.append(el('div', { className: 'actions' }, button, dismiss), message)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    button.disabled = true
    message.textContent = 'Saving answer…'
    try {
      const response = await fetch('/api/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, ...Object.fromEntries(new FormData(form)) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      for (const input of form.querySelectorAll('input, textarea')) input.readOnly = true
      if (body.memoryError || !body.memory.connected) {
        message.textContent = body.memoryError || 'Answer saved. Connect Walrus Memory, then retry to remember it.'
        button.textContent = 'Retry memory write'
        button.disabled = false
      } else {
        message.textContent = body.linkError || 'Answer saved and remembered.'
        button.textContent = 'Answered'
      }
    } catch (error) {
      message.textContent = error.message || 'Unable to save. Try again.'
      button.disabled = false
    }
  })
  return el('section', { className: 'question' }, el('h2', { textContent: question.fix ? 'Saved, not yet in Walrus Memory' : 'Waiting for an answer' }),
    el('time', { dateTime: question.created_at, textContent: new Date(question.created_at).toLocaleString() }),
    form)
}

try {
  const response = await fetch('/api/answer')
  if (!response.ok) throw new Error()
  const { questions } = await response.json()
  status.textContent = questions.length ? `${questions.length} ${questions.length === 1 ? 'question' : 'questions'} to review` : 'No questions waiting for an answer.'
  box.replaceChildren(...questions.map(questionForm))
} catch {
  status.textContent = 'Unable to load questions. Check your admin token and refresh.'
}

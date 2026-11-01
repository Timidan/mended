const box = document.querySelector('#questions')
const status = document.querySelector('#answer-status')

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function questionForm(question) {
  const fields = [
    ['title', 'Title', 'input', true], ['body', 'Fix', 'textarea', true],
    ['verify_fn', 'Sui function to watch (optional)', 'input', false],
    ['source_url', 'Source URL (optional)', 'input', false],
    ['sdk_version', 'SDK version (optional)', 'input', false],
    ['retire_at_version', 'Retire at SDK version (optional)', 'input', false],
  ]
  const form = el('form', { className: 'answer-form' })
  for (const [name, text, tag, required] of fields) {
    const id = `${question.id}-${name}`
    const input = el(tag, { id, name, required })
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
  form.append(button, message)
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
      if (body.memoryError || !body.memory.connected) {
        message.textContent = body.memoryError || 'Answer saved. Connect Walrus Memory, then retry to remember it.'
        button.textContent = 'Retry memory write'
        button.disabled = false
      } else {
        message.textContent = 'Answer saved and remembered.'
        button.textContent = 'Answered'
      }
    } catch (error) {
      message.textContent = error.message || 'Unable to save. Try again.'
      button.disabled = false
    }
  })
  return el('section', { className: 'question' }, el('h2', { textContent: question.fix ? 'Waiting to remember' : 'Waiting for an answer' }),
    el('time', { dateTime: question.created_at, textContent: new Date(question.created_at).toLocaleString() }),
    el('pre', { textContent: question.error }), form)
}

try {
  const response = await fetch('/api/answer')
  if (!response.ok) throw new Error()
  const { questions } = await response.json()
  status.textContent = questions.length ? `${questions.length} questions to review` : 'No questions waiting for an answer.'
  box.replaceChildren(...questions.map(questionForm))
} catch {
  status.textContent = 'Unable to load questions. Check your admin token and refresh.'
}

const form = document.querySelector('#ask')
const errorBox = document.querySelector('#error')
const addressBox = document.querySelector('#address')
const answer = document.querySelector('#answer')
const examples = document.querySelector('#examples')

const EXAMPLES = {
  tx: { error: 'My remove_delegate_key call failed:\nHkjZZKkt35QdjrWGbUFBR5eyMuHQaLLRsGCYwvuzC5DS', address: '' },
  key: { error: '401 AUTH_REJECTED from the relayer', address: '0x8c7fe3dd8ae17c133e7c2544014344aaee602950273a97c2c026c2ad1e257e14 7f3c9ad14e6b0258c1d7ea3096fb4c28d5e1a07b63c9f2148de0b57a1c6f3e92' },
  network: { error: 'Package object does not exist: 0x0a625e2db2af6f591a4c80a3d8551ddf11656089cc3a20c5e9e7f8fb75b9265c', address: '' },
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}

const panel = (title, ...body) => el('section', { className: 'panel-a' }, title ? el('h3', { textContent: title }) : null, ...body)
const line = (label, value) => el('div', {}, el('dt', { textContent: label }), el('dd', {}, value))
const link = (href, text, tone = '') => {
  try {
    const url = new URL(href)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return el('a', {
      href: url.href, textContent: text, target: '_blank', rel: 'noreferrer', className: ['good', 'bad'].includes(tone) ? tone : '',
    })
  } catch {}
  return el('span', { textContent: text })
}
const word = (text, tone) => el('span', { className: tone === 'plain' ? '' : tone, textContent: text })
const shortDigest = (d) => `${d.slice(0, 8)}…${d.slice(-6)}`
const clock = (iso) => new Date(iso).toISOString().slice(11, 19)

function gap(a, b) {
  const s = Math.round((new Date(b) - new Date(a)) / 1000)
  if (s < 90) return `${s} seconds later`
  if (s < 5400) return `${Math.round(s / 60)} minutes later`
  return `${Math.round(s / 3600)} hours later`
}

function transactionPanel(tx, retry) {
  const name = tx.call ? `${tx.call.module}::${tx.call.function}` : 'Transaction'
  const lines = [
    line('Call', el('span', { className: 'mono', textContent: name })),
    line('Result', word(tx.ok ? 'Succeeded' : 'Failed', tx.ok ? 'good' : 'bad')),
  ]
  if (tx.abort) lines.push(line('Abort code', el('span', { className: 'mono', textContent: tx.abortName ? `${tx.abort.code}, ${tx.abortName}` : tx.abort.code })))
  lines.push(line('Transaction', link(tx.href, shortDigest(tx.digest))))
  if (retry) {
    lines.push(line('Their next call to this function', word(`${retry.ok ? 'Succeeded' : 'Failed'}, ${gap(tx.timestamp, retry.timestamp)}`, retry.ok ? 'good' : 'bad')))
    lines.push(line('Next transaction', link(retry.href, shortDigest(retry.digest))))
  }
  return panel(`Transaction, ${tx.timestamp.slice(0, 10)} at ${clock(tx.timestamp)} UTC`, el('dl', { className: 'lines' }, ...lines))
}

function render(r) {
  const parts = []
  if (r.finding) {
    parts.push(el('section', { className: 'panel-a fix-a' }, el('h3', { textContent: r.finding.name ? `Walrus docs: ${r.finding.name}` : 'Walrus docs' }), el('p', { textContent: r.finding.text })))
  }
  if (r.fix) {
    const counts = el('p', { className: 'fix-counts', textContent: `${r.fix.verified} verified · ${r.fix.reported} reported` })
    const button = el('button', { className: 'btn pale', type: 'button', textContent: 'This worked' })
    const feedback = el('p', { className: 'report-state', role: 'status' })
    button.hidden = !r.questionId
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        const response = await fetch('/api/report', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questionId: r.questionId }),
        })
        if (!response.ok) throw new Error()
        const { reported } = await response.json()
        counts.textContent = `${r.fix.verified} verified · ${reported} reported`
        button.textContent = 'Reported'
        feedback.textContent = 'Thanks. Your report has been saved.'
      } catch {
        feedback.textContent = 'Unable to save your report. Try again.'
        button.disabled = false
      }
    })
    parts.push(el('section', { className: 'panel-a fix-a memory-fix' },
      el('h3', { textContent: r.fix.status === 'retired' ? `Retired: ${r.fix.retiredReason?.replace(/^Fixed/, 'fixed')}` : r.fix.possible ? `Possible match: ${r.fix.title}` : r.fix.title }), el('p', { className: 'fix-body', textContent: r.fix.body }), counts,
      r.fix.sourceUrl ? link(r.fix.sourceUrl, 'Source') : null, button, feedback))
  }
  if (r.watching) parts.push(panel(null, el('p', { textContent: `Watching ${r.watching === 'memory_write' ? 'the next memory write' : `the next ${r.watching} call`} on Sui for up to 7 days.` })))
  if (r.handedOff) parts.push(panel('Waiting for an answer', el('p', { textContent: 'Sent for a person to answer. Search again later to check for a fix.' })))
  if (r.memoryError) parts.push(panel('Memory unavailable', el('p', { textContent: r.memoryError })))
  else if (r.memory?.connected === false) parts.push(panel('Memory not connected', el('p', { textContent: 'Remembered fixes are unavailable. You can still check your account.' })))
  if (r.chainError) parts.push(el('section', { className: 'panel-a note' }, el('p', { textContent: `Unable to read Sui through Tatum (${r.chainError}). Try again in a moment.` })))
  if (r.nothingToCheck) parts.push(el('section', { className: 'panel-a note' }, el('p', { textContent: 'Add your Sui address or account ID to check your account on chain.' })))
  if (r.transaction) parts.push(transactionPanel(r.transaction, r.retry))
  if (r.checks?.length) {
    parts.push(panel(null, el('dl', { className: 'lines' }, ...r.checks.map((c) => line(c.label, c.href ? link(c.href, c.value, c.tone) : word(c.value, c.tone))))))
  }
  if (!parts.length) parts.push(el('section', { className: 'panel-a note' }, el('p', { textContent: 'No fix found for this error yet.' })))
  answer.replaceChildren(...parts)
  examples.hidden = true
}

async function run() {
  const button = form.querySelector('button')
  button.disabled = true
  button.textContent = 'Searching…'
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: errorBox.value, address: addressBox.value }),
    })
    const body = await res.json()
    if (res.ok) render(body)
    else answer.replaceChildren(el('section', { className: 'panel-a note' }, el('p', { textContent: body.error })))
  } catch {
    answer.replaceChildren(el('section', { className: 'panel-a note' }, el('p', { textContent: 'Unable to reach Mended. Check your connection and try again.' })))
  }
  button.disabled = false
  button.textContent = 'Search fixes'
}

function useExample(name) {
  const example = EXAMPLES[name]
  if (!example) return
  errorBox.value = example.error
  addressBox.value = example.address
  run()
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  run()
})
for (const b of document.querySelectorAll('[data-example]')) b.addEventListener('click', () => useExample(b.dataset.example))

const url = `${location.origin}/mcp`
document.querySelector('#cmd-claude').textContent = `claude mcp add --transport http mended ${url}`
document.querySelector('#cmd-codex').textContent = `codex mcp add mended --url ${url}`
document.querySelector('#mcp-url').textContent = url
for (const b of document.querySelectorAll('[data-copy]')) {
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent)
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = 'Copy'), 1500)
  })
}

const asked = new URLSearchParams(location.search).get('example')
if (asked) useExample(asked)

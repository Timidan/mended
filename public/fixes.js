const box = document.querySelector('#fixes')
const stats = document.querySelector('#stats')

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function sourceLink(fix) {
  try {
    const url = new URL(fix.source_url)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      return el('a', { href: url.href, target: '_blank', rel: 'noreferrer', textContent: fix.source === 'issue' ? 'Issue' : 'Source' })
    }
  } catch {}
  return el('span', { textContent: fix.source === 'person' ? 'Developer answer' : 'Unavailable' })
}

function verification(fix) {
  const links = fix.digests.map((digest) => el('a', {
    href: `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(digest)}`,
    target: '_blank', rel: 'noreferrer', textContent: `${digest.slice(0, 8)}…${digest.slice(-6)}`,
  }))
  if (!links.length) return el('span', { textContent: '0' })
  if (links.length === 1) {
    links[0].textContent = String(fix.verified)
    links[0].ariaLabel = `${fix.verified} verified addresses on Suiscan`
    return links[0]
  }
  return el('details', { className: 'transactions' }, el('summary', { textContent: String(fix.verified), ariaLabel: `${fix.verified} verified addresses` }),
    el('ul', {}, ...links.map((link) => el('li', {}, link))))
}

function render(fixes) {
  if (!fixes.length) {
    box.replaceChildren(el('p', { className: 'empty' }, 'No fixes yet. Verified and reported fixes will be listed here. ',
      el('a', { href: '/search', textContent: 'Search for an error' })))
    return
  }
  const headings = ['Fix', 'Status', 'Verified', 'Reported', 'SDK version', 'Source']
  const rows = fixes.map((fix) => {
    const status = fix.status === 'retired' ? 'Retired' : fix.verified ? 'Verified' : fix.reported ? 'Reported' : 'Active'
    return el('tr', { id: `fix-${fix.id}` },
      el('td', {}, el('strong', { textContent: fix.title }),
        el('details', { className: 'fix-details' }, el('summary', { textContent: 'Read fix' }),
          el('p', { className: 'fix-body', textContent: fix.body })),
        ...(fix.retired_reason ? [el('p', { className: 'retired-reason', textContent: fix.retired_reason })] : [])),
      el('td', {}, el('span', { className: `fix-status ${status.toLowerCase()}`, textContent: status })),
      el('td', { className: 'num' }, verification(fix)),
      el('td', { className: 'num', textContent: String(fix.reported) }),
      el('td', { textContent: fix.sdk_version || 'Not specified' }),
      el('td', {}, sourceLink(fix), ...(fix.blob_object_id ? [el('a', { href: `https://suiscan.xyz/mainnet/object/${encodeURIComponent(fix.blob_object_id)}`, target: '_blank', rel: 'noreferrer', textContent: 'Walrus object' })] : [])))
  })
  box.replaceChildren(el('div', { className: 'table-scroll', tabIndex: 0, role: 'region', ariaLabel: 'Fixes' },
    el('table', {}, el('caption', { className: 'sr', textContent: 'Fixes and their verification history' }),
      el('thead', {}, el('tr', {}, ...headings.map((text, i) => el('th', { scope: 'col', className: i === 2 || i === 3 ? 'num' : '', textContent: text })))),
      el('tbody', {}, ...rows))))
}

const results = await Promise.allSettled([
  fetch('/api/fixes').then(async (r) => {
    if (!r.ok) throw new Error()
    return r.json()
  }),
  fetch('/api/stats').then(async (r) => {
    if (!r.ok) throw new Error()
    return r.json()
  }),
])
if (results[0].status === 'fulfilled') render(results[0].value.fixes)
else box.replaceChildren(el('p', { className: 'empty', textContent: 'Unable to load fixes. Refresh to try again.' }))
if (results[1].status === 'fulfilled') {
  const data = results[1].value
  const today = data.days.find((d) => d.day === new Date().toISOString().slice(0, 10))
  stats.textContent = `${data.questions} questions · ${data.memory} answered from memory · ${today?.questions ?? 0} questions today (UTC)`
} else stats.textContent = 'Question counts are unavailable.'

const still = matchMedia('(prefers-reduced-motion: reduce)').matches

// Nav menus
const drops = [...document.querySelectorAll('.drop > button')]
const closeMenus = (except) => {
  for (const b of drops) {
    if (b === except) continue
    b.setAttribute('aria-expanded', 'false')
    b.nextElementSibling.hidden = true
  }
}
for (const b of drops) {
  b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') === 'true'
    closeMenus(b)
    b.setAttribute('aria-expanded', String(!open))
    b.nextElementSibling.hidden = open
  })
}
document.addEventListener('click', (e) => e.target.closest('.drop') || closeMenus())
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenus())

// Scrolling mends the statement: the broken pieces close up, then gold runs along the cracks.
// CRACKS match the clip-paths on .shard in style.css; BRANCHES are gold only.
const CRACKS = [
  [[37, 0], [35.5, 9], [36.6, 17], [34.4, 26], [35.6, 35], [33, 46], [34.4, 55], [32, 66], [33.4, 76], [30.6, 88], [31.6, 100]],
  [[66, 0], [67.6, 10], [66.4, 20], [68.6, 31], [67.2, 42], [69.4, 54], [67.8, 66], [70, 78], [68.4, 89], [69.6, 100]],
]
const BRANCHES = [
  [[34.4, 26], [30, 31], [26.5, 29], [21, 35]],
  [[69.4, 54], [73.5, 59], [77, 57], [83, 63]],
]
const clamp = (x) => Math.min(1, Math.max(0, x))
const statement = document.querySelector('.mend')
const seam = statement.querySelector('.seam')
const seams = [...seam.querySelectorAll('path')]
const promise = document.querySelector('.promise')

const paint = () => {
  const box = promise.getBoundingClientRect()
  const done = still ? 1 : clamp(-box.top / (box.height - innerHeight))
  const closing = clamp(done / 0.58)
  statement.style.setProperty('--broken', (1 - closing) ** 2 * (1 + closing))
  seams.forEach((path, i) => {
    const gold = clamp((done - 0.56 - i * 0.07) / 0.24)
    path.style.strokeDashoffset = path.getTotalLength() * (1 - gold)
  })
}

const drawSeams = () => {
  const { offsetWidth: w, offsetHeight: h } = statement
  seam.setAttribute('viewBox', `0 0 ${w} ${h}`)
  ;[...CRACKS, ...BRANCHES].forEach((points, i) => {
    const path = seams[i]
    path.setAttribute('d', `M${points.map(([x, y]) => `${(x / 100) * w} ${(y / 100) * h}`).join('L')}`)
    path.style.strokeDasharray = path.getTotalLength()
  })
  paint()
}
addEventListener('scroll', paint, { passive: true })
addEventListener('resize', drawSeams)
document.fonts?.ready.then(drawSeams)
drawSeams()

// The error log mends itself once it scrolls into view, then stops
const rows = [...document.querySelectorAll('.errors button')]
let timer = 0

const mend = (i) => {
  rows[i].classList.add('mended')
  rows.forEach((row, j) => {
    row.setAttribute('aria-expanded', String(i === j))
    document.getElementById(row.getAttribute('aria-controls')).hidden = i !== j
  })
}
const walk = (i) => {
  mend(i)
  if (i + 1 < rows.length) timer = setTimeout(walk, 3800, i + 1)
}
rows.forEach((row, i) =>
  row.addEventListener('click', () => {
    clearTimeout(timer)
    mend(i)
  }),
)
if (still) rows.forEach((row) => row.classList.add('mended'))
else {
  const watcher = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return
    watcher.disconnect()
    walk(0)
  }, { threshold: 0.45 })
  watcher.observe(document.querySelector('.error-log'))
}

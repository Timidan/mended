// A classic script in <head>, so the theme is set before the first paint.
const root = document.documentElement
const system = matchMedia('(prefers-color-scheme: dark)')
const stored = () => {
  try {
    return localStorage.getItem('theme')
  } catch {
    return null
  }
}
const apply = (theme) => {
  root.dataset.theme = theme
  document.querySelector('.theme')?.setAttribute('aria-pressed', String(theme === 'dark'))
  dispatchEvent(new Event('themechange'))
}

apply(stored() ?? (system.matches ? 'dark' : 'light'))
system.addEventListener('change', (e) => stored() || apply(e.matches ? 'dark' : 'light'))

addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('.theme')
  button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'))
  button.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem('theme', theme)
    } catch {}
    apply(theme)
  })
})

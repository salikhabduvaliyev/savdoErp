// Mavzu: light | dark | system
const KEY = 'erp.theme'
let media

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' }
}

function apply(mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setTheme(mode) {
  try { localStorage.setItem(KEY, mode) } catch { /* ignore */ }
  apply(mode)
  if (!media) {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => getTheme() === 'system' && apply('system'))
  }
}

export function initTheme() {
  setTheme(getTheme())
}

import axios from 'axios'
import { localizeError } from './errors'
import { getLang } from './i18n'

const api = axios.create({ baseURL: '/api' })

const TOKEN_KEY = 'erp.access'
const REFRESH_KEY = 'erp.refresh'

export const tokens = {
  get access() { return localStorage.getItem(TOKEN_KEY) },
  get refresh() { return localStorage.getItem(REFRESH_KEY) },
  set({ access, refresh }) {
    if (access) localStorage.setItem(TOKEN_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

const BRANCH_KEY = 'erp.branch'

/** Tanlangan filial (bo'sh — barcha filiallar). Har so'rovda X-Branch sarlavhasi bilan yuboriladi. */
export const branchStore = {
  get() {
    try { return localStorage.getItem(BRANCH_KEY) || '' } catch { return '' }
  },
  set(id) {
    try { id ? localStorage.setItem(BRANCH_KEY, String(id)) : localStorage.removeItem(BRANCH_KEY) } catch { /* ignore */ }
  },
}

api.interceptors.request.use((config) => {
  const t = tokens.access
  if (t) config.headers.Authorization = `Bearer ${t}`
  const b = branchStore.get()
  if (b) config.headers['X-Branch'] = b
  config.headers['Accept-Language'] = getLang() === 'ru' ? 'ru' : 'uz' // server xabarlari tanlangan tilda

  return config
})

let refreshing = null
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (error.response?.status === 402 && !window.location.pathname.startsWith('/expired')) {
      window.dispatchEvent(new Event('erp:expired'))
    }
    if (error.response?.status === 401 && tokens.refresh && !original._retry && !original.url.includes('/auth/')) {
      original._retry = true
      try {
        refreshing = refreshing || axios.post('/api/auth/refresh/', { refresh: tokens.refresh })
        const { data } = await refreshing
        tokens.set(data)
        return api(original)
      } catch {
        tokens.clear()
        window.location.href = '/login'
      } finally {
        refreshing = null
      }
    }
    return Promise.reject(error)
  },
)

/** DRF xatosidan o'qiladigan matn — tanlangan tilda, maydon yorlig'i bilan (errors.js) */
export function errorText(err) {
  return localizeError(err)
}

export default api

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import api, { branchStore, tokens } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!tokens.access)
  const [branch, setBranchState] = useState(branchStore.get())
  const [prefs, setPrefs] = useState({})
  const pending = useRef({})
  const timer = useRef(null)

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me/')
      // tanlangan filial endi ruxsat etilmagan bo'lsa — tozalash
      const ids = (data.available_branches || []).map((b) => String(b.id))
      const cur = branchStore.get()
      if (cur && !ids.includes(cur)) { branchStore.set(''); setBranchState('') }
      if (!cur && ids.length === 1) { branchStore.set(ids[0]); setBranchState(ids[0]) }
      setUser(data)
      setPrefs(data.preferences || {})
    } catch {
      tokens.clear()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tokens.access) loadMe()
  }, [loadMe])

  useEffect(() => {
    const onExpired = () => loadMe()
    window.addEventListener('erp:expired', onExpired)
    return () => window.removeEventListener('erp:expired', onExpired)
  }, [loadMe])

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password })
    tokens.set(data)
    await loadMe()
  }

  const logout = () => {
    tokens.clear()
    branchStore.set('')
    setUser(null)
  }

  const setBranch = (id) => {
    branchStore.set(id)
    setBranchState(id ? String(id) : '')
  }

  /** Foydalanuvchi sozlamasi (serverda saqlanadi, 600 ms kechikish bilan) */
  const setPref = useCallback((key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }))
    pending.current[key] = value
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const body = pending.current
      pending.current = {}
      api.patch('/auth/me/prefs/', body).catch(() => {})
    }, 600)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, reloadMe: loadMe, branch, setBranch, prefs, setPref }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)

const perm = (user, module) => user?.permissions?.[module] || {}

/** Modulni ko'rish huquqi */
// eslint-disable-next-line react-refresh/only-export-components
export const can = (user, module) => !!perm(user, module).view
// eslint-disable-next-line react-refresh/only-export-components
export const canCreate = (user, module) => !!perm(user, module).create
/** Tahrirlash huquqi */
// eslint-disable-next-line react-refresh/only-export-components
export const canEdit = (user, module) => !!perm(user, module).edit
// eslint-disable-next-line react-refresh/only-export-components
export const canDelete = (user, module) => !!perm(user, module).delete

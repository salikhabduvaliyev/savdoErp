import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import api, { errorText } from '../api'
import { can, useAuth } from '../auth'
import { getLang, LANGS, setLang, t } from '../i18n'
import { getTheme, setTheme } from '../theme'
import Icon from './Icon'
import { Field, Modal, toast } from './ui'

// Bitta navigatsiya hamma sahifada; ko'rinishi rol huquqlariga bog'liq.
// eslint-disable-next-line react-refresh/only-export-components
export const NAV = [
  { group: t("Asosiy"), items: [{ to: '/dashboard', label: t("Dashboard"), module: 'dashboard' }] },
  {
    group: t("Savdo"),
    items: [
      { to: '/orders', label: t("Buyurtmalar"), module: 'orders' },
      { to: '/sales', label: t("Sotuvlar"), module: 'sales' },
      { to: '/counterparties', label: t("Kontragentlar"), module: 'counterparties' },
    ],
  },
  {
    group: t("Xaridlar va ombor"),
    items: [
      { to: '/purchases', label: t("Xaridlar"), module: 'purchases', icon: 'purchases' },
      { to: '/warehouse', label: t("Ombor"), module: 'warehouse' },
      { to: '/products', label: t("Tovarlar"), module: 'products' },
    ],
  },
  {
    group: t("Ishlab chiqarish"),
    items: [
      { to: '/production-dashboard', label: t("Ishlab chiqarish dashboard"), module: 'production', icon: 'production-dashboard' },
      { to: '/production', label: t("Ishlab chiqarish"), module: 'production' },
    ],
  },
  {
    group: t("Moliya va xodimlar"),
    items: [
      { to: '/finance', label: t("Moliya"), module: 'finance' },
      { to: '/hr', label: t("KPI va oylik"), module: 'hr' },
    ],
  },
  {
    group: t("Tizim"),
    items: [
      { to: '/company', label: t("Kompaniya"), module: 'company' },
      { to: '/settings', label: t("Sozlamalar"), module: 'settings' },
    ],
  },
]

const COLLAPSE_KEY = 'erp.sidebar.collapsed'

function ChangePassword({ onClose }) {
  const [v, setV] = useState({ old_password: '', new_password: '', confirm: '' })
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (v.new_password !== v.confirm) return setError('Yangi parollar mos emas')
    try {
      await api.post('/auth/me/password/', v)
      toast("Parol o'zgartirildi")
      onClose()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={t("Parolni o'zgartirish")} onClose={onClose} dialog>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label={t("Joriy parol")} full><input type="password" value={v.old_password} onChange={(e) => setV({ ...v, old_password: e.target.value })} required /></Field>
        <Field label={t("Yangi parol")}><input type="password" value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })} required /></Field>
        <Field label={t("Takrorlang")}><input type="password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} required /></Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

const THEMES = [['light', t("Yorug'")], ['dark', t("Qorong'i")], ['system', t("Tizim")]]

function UserMenu() {
  const { user, logout, setPref } = useAuth()
  const [theme, setThemeState] = useState(getTheme())
  const changeTheme = (m) => { setTheme(m); setThemeState(m); setPref('theme', m) }
  const changeLang = (code) => {
    if (code === getLang()) return
    setLang(code)
    setPref('lang', code)
    setTimeout(() => window.location.reload(), 700)
  }
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{(user.full_name || '?')[0].toUpperCase()}</span>
        <span className="meta">
          <b>{user.full_name}</b>
          <small>{t(user.is_platform_admin ? 'Platforma admini' : user.is_owner ? 'Kompaniya egasi' : user.role_name || '—')}</small>
        </span>
      </button>
      {open && (
        <div className="dropdown">
          <div style={{ padding: '6px 10px 8px' }}>
            <div className="bold">{user.full_name}</div>
            <div className="small muted">{user.username}{user.company ? ` · ${user.company.name}` : ''}</div>
          </div>
          <hr />
          <div style={{ padding: '4px 10px' }}>
            <div className="small muted" style={{ marginBottom: 6 }}>{t('Mavzu')}</div>
            <div className="segmented" style={{ width: '100%' }}>
              {THEMES.map(([k, l]) => <button key={k} className={theme === k ? 'active' : ''} style={{ flex: 1, padding: '5px 6px' }} onClick={() => changeTheme(k)}>{t(l)}</button>)}
            </div>
            <div className="small muted" style={{ margin: '10px 0 6px' }}>{t('Til')}</div>
            <div className="segmented" style={{ width: '100%' }}>
              {LANGS.map((l) => <button key={l.code} className={getLang() === l.code ? 'active' : ''} style={{ flex: 1, padding: '5px 6px' }} onClick={() => changeLang(l.code)} title={l.label}>{l.label}</button>)}
            </div>
          </div>
          <hr />
          <button onClick={() => { setOpen(false); setPw(true) }}><Icon name="key" size={16} /> {t("Parolni o'zgartirish")}</button>
          {user.is_platform_admin && <a href="/admin/" target="_blank" rel="noreferrer"><Icon name="platform" size={16} /> {t("Django admin")}</a>}
          <hr />
          <button className="danger" onClick={logout}><Icon name="logout" size={16} /> {t('Chiqish')}</button>
        </div>
      )}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </div>
  )
}

function SubscriptionBadge({ company }) {
  if (!company) return null
  if (company.status === 'trial') {
    return <span className={'sub-badge ' + (company.days_left <= 3 ? 'warn' : 'trial')} title={t('Sinov muddati')}>{t('Sinov: {n} kun qoldi', { n: company.days_left })}</span>
  }
  if (company.status === 'active' && company.days_left <= 7) {
    return <span className="sub-badge warn">{t('Obuna: {n} kun qoldi', { n: company.days_left })}</span>
  }
  return null
}

export default function Layout({ platform = false }) {
  const { user, branch, setBranch, prefs } = useAuth()
  const loc = useLocation()
  // server sozlamalarini qo'llash (boshqa qurilmada o'zgartirilgan bo'lsa)
  useEffect(() => {
    if (prefs.theme && prefs.theme !== getTheme()) setTheme(prefs.theme)
    if (prefs.lang && prefs.lang !== getLang()) { setLang(prefs.lang); window.location.reload() }
  }, [prefs.theme, prefs.lang])
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [loc.pathname])

  const toggle = () => {
    if (window.matchMedia('(max-width: 900px)').matches) return setMobileOpen((o) => !o)
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }

  const company = user.company
  const branches = user.available_branches || []
  const nav = platform
    ? [{ group: t("Platforma"), items: [{ to: '/platform', label: t("Kompaniyalar"), icon: 'platform' }] }]
    : NAV
  const current = nav.flatMap((g) => g.items).find((i) => loc.pathname.startsWith(i.to))

  return (
    <div className={'shell' + (collapsed ? ' collapsed' : '') + (mobileOpen ? ' mobile-open' : '')}>
      <aside className="sidebar">
        <div className="sb-brand">
          {company?.logo ? <img src={company.logo} alt="" /> : <span className="sb-logo">{(company?.name || 'A')[0]}</span>}
          <span className="sb-name">{platform ? 'Akfa ERP · Platforma' : company?.name || 'Akfa ERP'}</span>
        </div>
        <nav className="sb-nav">
          {nav.map((g) => {
            const items = g.items.filter((i) => platform || can(user, i.module))
            if (!items.length) return null
            return (
              <div key={g.group} className="sb-group">
                <div className="sb-group-title">{t(g.group)}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')} title={t(i.label)}>
                    <Icon name={i.icon || i.module} />
                    <span>{t(i.label)}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sb-foot"><span>{t("Akfa ERP · v1.0")}</span></div>
      </aside>
      <div className="sb-backdrop" onClick={() => setMobileOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={toggle} title={collapsed ? 'Menyuni ochish' : "Menyuni yig'ish"} aria-label={t("Menyu")}>
            <Icon name="sidebar" size={19} />
          </button>
          <span className="title">{t(current?.label)}</span>
          <span className="spacer" />
          {!platform && <SubscriptionBadge company={company} />}
          {!platform && branches.length > 1 && (
            <label className="branch-select" title={t("Filial")}>
              <Icon name="branch" size={16} />
              <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                {(user.branches || []).length === 0 && <option value="">{t('Barcha filiallar')}</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <UserMenu />
        </header>
        <main className="page" key={branch /* filial almashsa sahifa qayta yuklanadi */}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'
import api, { errorText } from '../api'
import { money } from '../format'
import { t } from '../i18n'

/** GET so'rov + qayta yuklash */
export function useFetch(url, params) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const key = url + JSON.stringify(params || {})

  const reload = useCallback(async () => {
    if (!url) return
    setLoading(true)
    try {
      const { data } = await api.get(url, { params })
      setData(data)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}

/** UZS, USD — birinchi; qolgan valyutalar alifbo tartibida */
function bagKeys(bag) {
  return ['UZS', 'USD', ...Object.keys(bag || {}).filter((c) => c !== 'UZS' && c !== 'USD').sort()]
}

/** Valyuta bo'yicha alohida summa: {UZS, USD} — har biri o'z qatorida. Nol bo'lsa ko'rsatilmaydi. */
export function MoneyBag({ bag, showZero = false, inline = false }) {
  if (!bag) return <span className="muted">—</span>
  const parts = bagKeys(bag)
    .filter((c) => showZero ? ['UZS', 'USD'].includes(c) || Number(bag[c]) !== 0 : Number(bag[c]) !== 0)
    .map((c) => (
      <div key={c} className={c === 'USD' ? 'usd-line' : ''} style={inline ? { display: 'inline' } : undefined}>
        {money(bag[c], c)}
      </div>
    ))
  if (!parts.length) return <span className="muted">0</span>
  if (inline) return <span>{parts.reduce((acc, p, i) => (i ? [...acc, ' · ', p] : [p]), [])}</span>
  return <>{parts}</>
}

export function Stat({ label, bag, value, sub, valueClass }) {
  return (
    <div className="card stat">
      <div className="label">{t(label)}</div>
      {bag ? (
        <>
          <div className="value">{money(bag.UZS, 'UZS')}</div>
          <div className="value usd">{money(bag.USD, 'USD')}</div>
          {bagKeys(bag).filter((c) => c !== 'UZS' && c !== 'USD' && Number(bag[c]) !== 0).map((c) => <div key={c} className="value usd">{money(bag[c], c)}</div>)}
        </>
      ) : (
        <div className={'value ' + (valueClass || '')}>{value}</div>
      )}
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Badge({ kind, children }) {
  return <span className={`badge b-${kind}`}>{typeof children === 'string' ? t(children) : children}</span>
}

/**
 * Brauzer "Orqaga" tugmasi to'liq sahifani yopishi uchun tarix yozuvi.
 * Har bir ochiq sahifa o'z chuqurligini (fpDepth) eslab qoladi.
 */
function useHistoryClose(onClose) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    let depth = 0
    // StrictMode effektni ikki marta ishga tushiradi — yozuvni keyingi tikda qo'shamiz
    const timer = setTimeout(() => {
      depth = (window.history.state?.fpDepth || 0) + 1
      window.history.pushState({ ...(window.history.state || {}), fpDepth: depth }, '')
    })
    const isTop = () => depth && window.history.state?.fpDepth === depth
    const onPop = () => { if (depth && (window.history.state?.fpDepth || 0) < depth) closeRef.current() }
    const onKey = (e) => { if (e.key === 'Escape' && isTop() && !document.querySelector('.modal-back')) closeRef.current() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      // tugma bilan yopilganda — o'zimiz qo'shgan tarix yozuvini olib tashlaymiz
      if (isTop()) window.history.back()
    }
  }, [])
}

/** To'liq sahifa: yon menyu va yuqori panel ko'rinib turadi, kontent maydonini to'liq egallaydi. */
export function FullPage({ title, onClose, children, wide, actions, bare }) {
  useHistoryClose(onClose)
  const host = document.querySelector('.main') || document.body
  return createPortal(
    <div className="fullpage" role="dialog" aria-label={typeof title === 'string' ? t(title) : undefined}>
      <div className={'fullpage-inner' + (wide ? ' wide' : '')}>
        {bare ? children : <>
        <div className="fullpage-head">
          <button type="button" className="btn" onClick={onClose}><ArrowLeft size={16} /> {t('Orqaga')}</button>
          {title && <h1>{typeof title === 'string' ? t(title) : title}</h1>}
          <div className="grow" />
          {actions}
        </div>
        <div className="fullpage-body">{children}</div>
        </>}
      </div>
    </div>,
    host,
  )
}

/**
 * Formalar to'liq sahifada ochiladi. `dialog` — faqat kichik tasdiqlash oynalari
 * (masalan, parol almashtirish) uchun eski modal ko'rinish.
 */
// Sozlamalar bo'limida barcha formalar modal oynada ochiladi
// eslint-disable-next-line react-refresh/only-export-components
export const DialogMode = createContext(false)

export function Modal({ title, onClose, children, wide, dialog }) {
  const forced = useContext(DialogMode)
  if (!dialog && !forced) return <FullPage title={title} onClose={onClose} wide={wide}>{children}</FullPage>
  return <DialogBox title={title} onClose={onClose} wide={wide}>{children}</DialogBox>
}

function DialogBox({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  // portal: to'liq sahifa (fullpage) ichida ochilsa ham yon menyu ustida turadi
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{t(title)}</h2>
          <button className="x" onClick={onClose} aria-label={t("Yopish")}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, children, full }) {
  return (
    <div className={'field' + (full ? ' full' : '')}>
      <label>{t(label)}</label>
      {children}
    </div>
  )
}

export function Loading({ error }) {
  if (error) return <div className="error">{error}</div>
  return <div className="empty">{t("Yuklanmoqda…")}</div>
}

export function Progress({ value, big, tone }) {
  const pctVal = Math.max(0, Math.min(100, Math.round((value || 0) * 100)))
  return (
    <div className={'progress' + (big ? ' big' : '')}>
      <div className={tone || ''} style={{ width: pctVal + '%' }} />
    </div>
  )
}

/** Oddiy forma holati */
export function useForm(initial) {
  const [values, setValues] = useState(initial)
  const bind = (name) => ({
    value: values[name] ?? '',
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  })
  return { values, setValues, bind }
}

let toastTimer
export function toast(text, isError = false) {
  let el = document.getElementById('erp-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'erp-toast'
    document.body.appendChild(el)
  }
  el.className = 'toast' + (isError ? ' err' : '')
  el.textContent = t(text)
  el.style.display = 'block'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.style.display = 'none' }, 3500)
}

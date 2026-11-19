// Umumiy kiritish maydonlari (MoySklad uslubi):
//   <DateInput>  — dd.mm.yyyy (ixtiyoriy HH:mm), dushanbadan boshlanadigan kalendar, «Bugun» / «Tozalash»
//   <NumInput>   — summa va miqdor: yozish paytida 3 000 / 3 000.50 ko'rinishida guruhlanadi
// Ikkalasi ham oddiy <input> o'rnini bosadi: onChange({ target: { value, name } }) — value ISO sana / toza raqam.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'

const pad = (n) => String(n).padStart(2, '0')
const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr']
const WEEK_UZ = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
const ev = (value, name) => ({ target: { value, name, type: 'text' }, currentTarget: { value, name } })

function parseISO(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return null
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 }
}
const toISO = (p, time) => `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}` + (time ? `T${pad(p.h)}:${pad(p.mi)}` : '')
const toText = (p, time) => (p ? `${pad(p.d)}.${pad(p.mo + 1)}.${p.y}` + (time ? ` ${pad(p.h)}:${pad(p.mi)}` : '') : '')

/** "19.11.2026", "19.11.26", "19112026", "19.11.2026 14:30" → sana qismlari */
function parseText(s) {
  const txt = String(s || '').trim()
  if (!txt) return null
  const m = txt.match(/^(\d{1,2})[./-]?(\d{1,2})[./-]?(\d{2,4})(?:\s+(\d{1,2}):?(\d{2}))?$/)
  if (!m) return undefined
  let y = +m[3]
  if (y < 100) y += 2000
  const p = { y, mo: +m[2] - 1, d: +m[1], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 }
  const dt = new Date(p.y, p.mo, p.d)
  if (dt.getMonth() !== p.mo || p.h > 23 || p.mi > 59) return undefined
  return p
}

function usePopupPos(anchor, open) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open || !anchor.current) return undefined
    const place = () => {
      const r = anchor.current.getBoundingClientRect()
      const W = 286
      const H = 340
      const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8)
      const top = r.bottom + H + 8 > window.innerHeight && r.top > H ? r.top - H - 4 : r.bottom + 4
      setPos({ left, top })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, anchor])
  return pos
}

export function DateInput({ value, onChange, time = false, disabled, className = '', placeholder, name, required, style, title }) {
  const cur = parseISO(value)
  const [text, setText] = useState(toText(cur, time))
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => cur || { y: new Date().getFullYear(), mo: new Date().getMonth() })
  const box = useRef(null)
  const pop = useRef(null)
  const pos = usePopupPos(box, open)

  useEffect(() => { setText(toText(parseISO(value), time)) }, [value, time])
  useEffect(() => {
    if (!open) return undefined
    const h = (e) => { if (!box.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const emit = (p) => onChange?.(ev(p ? toISO(p, time) : '', name))
  const commitText = () => {
    const p = parseText(text)
    if (p === undefined) { setText(toText(cur, time)); return } // noto'g'ri — eski qiymat
    if ((p ? toISO(p, time) : '') !== (value || '')) emit(p)
  }
  const openCal = () => { if (disabled) return; setView(cur || { y: new Date().getFullYear(), mo: new Date().getMonth() }); setOpen((o) => !o) }
  const pick = (y, mo, d) => {
    const n = new Date()
    emit({ y, mo, d, h: cur?.h ?? n.getHours(), mi: cur?.mi ?? n.getMinutes() })
    if (!time) setOpen(false)
  }
  const shift = (k) => setView((v) => { const d = new Date(v.y, v.mo + k, 1); return { y: d.getFullYear(), mo: d.getMonth() } })

  // kalendar katakchalari: dushanbadan boshlanadi, oldingi/keyingi oy kunlari xira
  const first = new Date(view.y, view.mo, 1)
  const start = new Date(view.y, view.mo, 1 - ((first.getDay() + 6) % 7))
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const today = new Date()
  const same = (dt, p) => p && dt.getFullYear() === p.y && dt.getMonth() === p.mo && dt.getDate() === p.d

  return (
    <span className={'dinput' + (disabled ? ' disabled' : '') + (time ? ' with-time' : '')} ref={box} style={style}>
      <input className={className} value={text} disabled={disabled} required={required} title={title}
        placeholder={placeholder || (time ? 'kk.oo.yyyy ss:dd' : 'kk.oo.yyyy')}
        onChange={(e) => setText(e.target.value)} onBlur={commitText}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText() } if (e.key === 'ArrowDown' && e.altKey) openCal() }} />
      <button type="button" className="dinput-btn" tabIndex={-1} disabled={disabled} onClick={openCal} aria-label={t('Kalendar')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      </button>
      {open && pos && createPortal(
        <div className="dpop" ref={pop} style={{ left: pos.left, top: pos.top }}>
          <div className="dpop-head">
            <button type="button" onClick={() => shift(-1)} aria-label={t('Oldingi oy')}>‹</button>
            <b>{t(MONTHS_UZ[view.mo])} {view.y}</b>
            <button type="button" onClick={() => shift(1)} aria-label={t('Keyingi oy')}>›</button>
          </div>
          <div className="dpop-grid">
            {WEEK_UZ.map((w) => <span key={w} className="dpop-wd">{t(w)}</span>)}
            {cells.map((dt) => (
              <button type="button" key={dt.toISOString()}
                className={'dpop-day' + (dt.getMonth() !== view.mo ? ' out' : '') + (same(dt, cur) ? ' sel' : '')
                  + (dt.toDateString() === today.toDateString() ? ' today' : '') + ((dt.getDay() + 6) % 7 >= 5 ? ' we' : '')}
                onClick={() => pick(dt.getFullYear(), dt.getMonth(), dt.getDate())}>{dt.getDate()}</button>
            ))}
          </div>
          {time && cur && (
            <div className="dpop-time">
              <input type="number" min="0" max="23" value={pad(cur.h)} onChange={(e) => emit({ ...cur, h: Math.min(23, Math.max(0, +e.target.value || 0)) })} />
              <b>:</b>
              <input type="number" min="0" max="59" value={pad(cur.mi)} onChange={(e) => emit({ ...cur, mi: Math.min(59, Math.max(0, +e.target.value || 0)) })} />
            </div>
          )}
          <div className="dpop-foot">
            <button type="button" className="link-btn" onClick={() => { const n = new Date(); emit({ y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes() }); setOpen(false) }}>{t('Bugun')}</button>
            {!required && <button type="button" className="link-btn muted" onClick={() => { emit(null); setOpen(false) }}>{t('Tozalash')}</button>}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ raqamlar */
/** Toza qiymat ("3000.5") → ko'rinish ("3 000.5") */
export function groupNum(raw) {
  if (raw === null || raw === undefined || raw === '') return ''
  const s = String(raw)
  const neg = s.startsWith('-')
  const [int, dec] = s.replace('-', '').split('.')
  const g = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (neg ? '-' : '') + g + (dec !== undefined ? '.' + dec : '')
}
/** Foydalanuvchi matni → toza qiymat: bo'shliqlar olinadi, vergul nuqtaga aylanadi */
export function cleanRaw(s, { allowNeg = false } = {}) {
  let v = String(s ?? '').replace(/\s/g, '').replace(/,/g, '.')
  v = v.replace(allowNeg ? /[^\d.-]/g : /[^\d.]/g, '')
  if (allowNeg) v = v.replace(/(?!^)-/g, '')
  const i = v.indexOf('.')
  if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '')
  return v
}

export function NumInput({ value, onChange, className = '', name, allowNeg, decimals, min, max, step, type, ...rest }) { // eslint-disable-line no-unused-vars
  const ref = useRef(null)
  const caret = useRef(null)
  const raw = value === null || value === undefined ? '' : String(value)
  const shown = groupNum(raw)

  useLayoutEffect(() => {
    // kursor joyi: guruhlash bo'shliqlari qo'shilganda ham shu raqamdan keyin qoladi
    if (caret.current === null || !ref.current || document.activeElement !== ref.current) return
    const digits = caret.current
    let n = 0
    let pos = 0
    while (pos < shown.length && n < digits) { if (/[\d.-]/.test(shown[pos])) n += 1; pos += 1 }
    ref.current.setSelectionRange(pos, pos)
    caret.current = null
  }, [shown])

  const change = (e) => {
    const el = e.target
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    caret.current = before.replace(/[^\d.,-]/g, '').length
    let v = cleanRaw(el.value, { allowNeg })
    if (decimals !== undefined && v.includes('.')) v = v.slice(0, v.indexOf('.') + 1 + decimals)
    onChange?.({ target: { value: v, name, type: 'text' }, currentTarget: { value: v, name } })
  }
  return <input ref={ref} {...rest} name={name} className={className} inputMode="decimal" value={shown} onChange={change} />
}

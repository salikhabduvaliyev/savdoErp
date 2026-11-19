// Umumiy boshqaruv elementlari: qidiruvli tanlash, sahifalash, ommaviy amallar menyusi
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import Icon from './Icon'

const norm = (s) => String(s ?? '').toLowerCase().replace(/[ʻʼ‘’`']/g, "'")

/**
 * Qidiruvli tanlash (MoySklad uslubi): <SearchSelect value onChange options=[{value,label,sub}] placeholder empty />
 * `empty` — bo'sh qiymat matni (masalan "— hammasi —"); berilmasa bo'sh qiymat tanlanmaydi.
 */
export function SearchSelect({ value, onChange, options, placeholder, empty, disabled, className = '', onCreate, createLabel }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef(null)
  const input = useRef(null)
  const selected = options.find((o) => String(o.value) === String(value ?? ''))

  const list = useMemo(() => {
    const n = norm(q.trim())
    const rows = n ? options.filter((o) => norm(o.label).includes(n) || norm(o.sub).includes(n)) : options
    return rows.slice(0, 300)
  }, [q, options])
  const all = empty !== undefined ? [{ value: '', label: empty, isEmpty: true }, ...list] : list

  useEffect(() => {
    if (!open) return undefined
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    setTimeout(() => input.current?.focus(), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const pick = (o) => { onChange(o.value, o); setOpen(false); setQ('') }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, all.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); if (all[active]) pick(all[active]) }
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }

  return (
    <div className={'ss ' + className + (disabled ? ' disabled' : '') + (open ? ' open' : '')} ref={box}>
      <button type="button" className="ss-btn" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled}>
        <span className={selected ? 'ss-val' : 'ss-ph'}>{selected ? selected.label : (value ? String(value) : (empty ?? placeholder ?? t('— tanlang —')))}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="ss-pop">
          <div className="ss-search">
            <Icon name="search" size={15} />
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder={t('Qidirish…')} />
          </div>
          <div className="ss-list">
            {all.map((o, i) => (
              <button type="button" key={String(o.value) + i} className={'ss-item' + (i === active ? ' active' : '') + (String(o.value) === String(value ?? '') ? ' sel' : '') + (o.isEmpty ? ' muted' : '')}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
              </button>
            ))}
            {!list.length && <div className="ss-empty">{t('Topilmadi')}</div>}
          </div>
          {onCreate && (
            <button type="button" className="ss-create" onClick={() => { onCreate(q.trim()); setOpen(false); setQ('') }}>
              <Icon name="plus" size={15} /> {q.trim() ? t('«{q}» — yangi yaratish', { q: q.trim() }) : (createLabel || t('Yangi yaratish'))}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const PAGE_KEY = 'erp.pageSize'
const readSize = (d) => { try { return Number(localStorage.getItem(PAGE_KEY)) || d } catch { return d } }

/** Sahifalash (MoySklad: 1–50 / 345, 25 · 50 · 100): const { rows, pager } = usePager(data, 50, resetKey) */
export function usePager(items, size0 = 50, resetKey) {
  const [page, setPage] = useState(0)
  const [size, setSizeState] = useState(() => readSize(size0))
  const setSize = (n) => { setSizeState(n); setPage(0); try { localStorage.setItem(PAGE_KEY, String(n)) } catch { /* ignore */ } }
  const total = items?.length || 0
  const pages = Math.max(1, Math.ceil(total / size))
  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) { setPrevKey(resetKey); setPage(0) }
  const p = Math.min(page, pages - 1)
  const rows = (items || []).slice(p * size, p * size + size)
  const pager = total ? (
    <div className="pager">
      <span className="pager-sizes">
        {[25, 50, 100].map((n) => <button key={n} className={n === size ? 'active' : ''} onClick={() => setSize(n)}>{n}</button>)}
      </span>
      <span className="grow" />
      <button className="icon-act" disabled={p === 0} onClick={() => setPage(0)} title={t('Birinchi')}>«</button>
      <button className="icon-act" disabled={p === 0} onClick={() => setPage(p - 1)} title={t('Oldingi')}><Icon name="chevron" size={15} /></button>
      <span>{p * size + 1}–{Math.min(total, (p + 1) * size)} / {total}</span>
      <button className="icon-act" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} title={t('Keyingi')}><Icon name="chevron-right" size={15} /></button>
      <button className="icon-act" disabled={p >= pages - 1} onClick={() => setPage(pages - 1)} title={t('Oxirgi')}>»</button>
    </div>
  ) : null
  return { rows, pager, page: p, size }
}

/** "O'zgartirish ▾" — tanlanganlar uchun amallar menyusi. items: [{label, onClick, danger, sub: [{label,onClick}]}] */
export function BulkMenu({ count, items, label }) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(null)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const h = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setSub(null) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="bulk" ref={box}>
      <span className="bulk-count">{count}</span>
      <button className="btn small" disabled={!count} onClick={() => setOpen((o) => !o)}>{label || t("O'zgartirish")} <Icon name="chevron-down" size={14} /></button>
      {open && (
        <div className="bulk-menu">
          {items.map((it, i) => (it.divider ? <hr key={i} /> : (
            <div key={i} className="bulk-row" onMouseEnter={() => setSub(it.sub ? i : null)}>
              <button className={'bulk-item' + (it.danger ? ' danger' : '')} disabled={it.disabled}
                onClick={() => { if (it.sub) { setSub(i); return } setOpen(false); it.onClick() }}>
                {it.label}{it.sub && <Icon name="chevron-right" size={14} />}
              </button>
              {it.sub && sub === i && (
                <div className="bulk-menu bulk-sub">
                  {it.sub.map((s, j) => <button key={j} className="bulk-item" onClick={() => { setOpen(false); setSub(null); s.onClick() }}>{s.label}</button>)}
                </div>
              )}
            </div>
          )))}
        </div>
      )}
    </div>
  )
}

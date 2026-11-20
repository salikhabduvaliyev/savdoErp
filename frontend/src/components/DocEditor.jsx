// MoySklad uslubidagi hujjat tahrirlovchisi: tepada amallar, rekvizitlar, pozitsiyalar, pastda jami.
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import { money, qty as fmtQty } from '../format'
import { t } from '../i18n'
import Icon, { IconBtn } from './Icon'
import { FullPage, Modal } from './ui'
import { DateInput, NumInput } from './Inputs'
import { newProductDialog } from './NewProduct'

let keySeq = 0
export const newKey = () => `k${++keySeq}`
/** "1650000.00" → "1650000" (tahrirlash uchun qulay) */
export const cleanNum = (v) => (v === '' || v === null || v === undefined ? '' : String(Number(v)))

export function lineAmount(l) {
  const a = Number(l.qty || 0) * Number(l.price || 0) * (1 - Number(l.discount_pct || 0) / 100)
  return Math.round(a * 100) / 100
}

/** Hujjat sahifasi: to'liq kenglik, tepada asboblar paneli (Saqlash · Yopish · ...). */
export function DocPage({ onClose, toolbar, children }) {
  return (
    <FullPage onClose={onClose} bare wide>
      <div className="doc-toolbar">{toolbar}</div>
      {children}
    </FullPage>
  )
}

/** "Buyurtma № [  ] dan [sana]" sarlavhasi */
export function DocTitle({ label, number, date, onDate, children }) {
  return (
    <div className="doc-titlebar">
      <h1>{t(label)} №</h1>
      <input className="doc-num" value={number ?? ''} readOnly placeholder={t('avto')} title={t('Raqam saqlanganda beriladi')} />
      <span className="doc-from">{t('dan')}</span>
      <DateInput className="doc-date" value={date || ''} onChange={(e) => onDate?.(e.target.value)} disabled={!onDate} />
      {children}
    </div>
  )
}

/** Rekvizit qatori: chapda nom, o'ngda maydon (MoySklad formasi) */
export function DocField({ label, required, children, wide }) {
  return (
    <div className={'doc-field' + (wide ? ' wide' : '')}>
      <label>{required && <span className="req">*</span>}{t(label)}</label>
      <div className="doc-field-input">{children}</div>
    </div>
  )
}

/** Tovarni nomi/kodi/shtrix-kodi bo'yicha qidirib qo'shish (jadval ostidagi qator). */
export function ProductSearch({ onPick, onFree, params, disabled }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)

  useEffect(() => {
    if (!q.trim()) { setItems([]); return undefined }
    let alive = true
    const h = setTimeout(async () => {
      try {
        const { data } = await api.get('/warehouse/products/', { params: { search: q.trim(), is_active: true, ...params } })
        if (alive) { setItems((data.results || data).slice(0, 15)); setActive(0); setOpen(true) }
      } catch { /* qidiruv xatosi — e'tiborsiz */ }
    }, 220)
    return () => { alive = false; clearTimeout(h) }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pick = (p) => { onPick(p); setQ(''); setItems([]); setOpen(false) }
  const free = () => { if (q.trim() && onFree) { onFree(q.trim()); setQ(''); setOpen(false) } }
  // yangi tovar oynasi (qidiruvda topilmasa): yaratilgach darhol pozitsiyaga qo'shiladi
  const create = async () => {
    const name = q.trim()
    setOpen(false)
    const types = String(params?.type || '').split(',').filter(Boolean)
    const p = await newProductDialog({ name, type: types.length === 1 ? types[0] : undefined })
    if (p) { onPick(p); setQ(''); setItems([]) }
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - (onFree ? 0 : 1))) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (items[active]) pick(items[active])
      else free()
    }
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }

  return (
    <div className="psearch" ref={box}>
      <Icon name="search" size={16} className="psearch-ic" />
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} onFocus={() => items.length && setOpen(true)}
        placeholder={t("Pozitsiya qo'shish: nomi, kodi yoki shtrix-kodi…")} disabled={disabled} />
      {open && q.trim() && (
        <div className="psearch-list">
          {items.map((p, i) => (
            <button type="button" key={p.id} className={'psearch-item' + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
              <span className="code">{p.sku || '—'}</span>
              <span className="name">{p.name}<small>{t(p.type_display)}</small></span>
              <span className="stock">{p.stock_qty !== null && p.stock_qty !== undefined ? `${fmtQty(p.stock_qty)} ${t(p.unit_display || '')}` : ''}</span>
            </button>
          ))}
          {!items.length && <div className="psearch-empty">{t('Topilmadi')}</div>}
          <button type="button" className="psearch-item free create" onClick={create}>
            <Icon name="plus" size={15} /> {t('«{q}» — yangi tovar yaratish', { q: q.trim() })}
          </button>
          {onFree && (
            <button type="button" className={'psearch-item free' + (active === items.length ? ' active' : '')} onClick={free}>
              <Icon name="plus" size={15} /> {t('«{q}» nomli qator qo\'shish', { q: q.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Ma'lumotnomadan tanlash (MoySklad "Выбор товара"): chapda guruhlar, har qatorda miqdor (−/+), pastda "Tanlash" */
function ProductPicker({ onPick, onClose, params }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [rows, setRows] = useState(null)
  const [qty, setQty] = useState({})
  const [groups, setGroups] = useState([])
  const [pts, setPts] = useState([])
  useEffect(() => {
    api.get('/warehouse/groups/').then(({ data }) => setGroups(data)).catch(() => {})
    api.get('/warehouse/price-types/').then(({ data }) => setPts(data)).catch(() => {})
  }, [])
  useEffect(() => {
    let alive = true
    setRows(null)
    const h = setTimeout(async () => {
      const { data } = await api.get('/warehouse/products/', { params: { search: q || undefined, group: group || undefined, is_active: true, ...params } })
      if (alive) setRows(data.results || data)
    }, 200)
    return () => { alive = false; clearTimeout(h) }
  }, [q, group]) // eslint-disable-line react-hooks/exhaustive-deps
  const defPt = pts.find((x) => x.is_default) || pts[0]
  const tree = useMemo(() => {
    const by = {}
    for (const g of groups) (by[g.parent || 0] ||= []).push(g)
    const out = []
    const walk = (pid, d) => (by[pid] || []).sort((x, y) => x.name.localeCompare(y.name)).forEach((g) => { out.push({ ...g, d }); walk(g.id, d + 1) })
    walk(0, 0)
    return out
  }, [groups])
  const setQ1 = (id, v) => setQty((s) => ({ ...s, [id]: v }))
  const chosen = Object.entries(qty).filter(([, v]) => Number(v) > 0)
  const byId = useMemo(() => Object.fromEntries((rows || []).map((r) => [r.id, r])), [rows])
  const [cache, setCache] = useState({})
  useEffect(() => { if (rows) setCache((c) => ({ ...c, ...Object.fromEntries(rows.map((r) => [r.id, r])) })) }, [rows])
  const submit = () => {
    chosen.forEach(([id, v]) => { const pr = byId[id] || cache[id]; if (pr) onPick(pr, Number(v)) })
    onClose()
  }
  return (
    <Modal title="Tovar tanlash" onClose={onClose} wide dialog>
      <div className="picker">
        <div className="picker-groups">
          <button className={'gt-item' + (!group ? ' active' : '')} onClick={() => setGroup('')}>{t('Tovarlar va xizmatlar')}</button>
          {tree.map((g) => (
            <button key={g.id} className={'gt-item' + (String(group) === String(g.id) ? ' active' : '')} style={{ paddingLeft: 10 + g.d * 14 }} onClick={() => setGroup(g.id)}>{g.name}</button>
          ))}
        </div>
        <div className="picker-main">
          <div className="psearch" style={{ maxWidth: 'none', marginBottom: 10 }}>
            <Icon name="search" size={16} className="psearch-ic" />
            <input autoFocus placeholder={t('Nomi, kod yoki artikul')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="table-wrap picker-table">
            <table className="t compact">
              <thead><tr><th>{t('Nomi')}</th><th className="num" style={{ width: 150 }}>{t('Miqdor')}</th><th className="num">{t('Qoldiq')}</th><th className="num">{t('Xarid narxi')}</th><th className="num">{t('Sotuv narxi')}</th></tr></thead>
              <tbody>
                {!rows && <tr><td colSpan={5} className="empty">{t('Yuklanmoqda…')}</td></tr>}
                {(rows || []).map((p) => {
                  const v = qty[p.id] ?? ''
                  const sale = defPt ? p.prices?.[defPt.id] : null
                  return (
                    <tr key={p.id} className={Number(v) > 0 ? 'picked' : ''}>
                      <td>{p.code && <span className="pos-code">{p.code}</span>}<b>{p.name}</b> <span className="muted small">{t(p.unit_display)}</span></td>
                      <td className="num">
                        <div className="mini-stepper">
                          <button type="button" onClick={() => setQ1(p.id, String(Math.max(0, Number(v || 0) - 1)))}>−</button>
                          <input inputMode="decimal" value={v} placeholder="0" onChange={(e) => setQ1(p.id, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && submit()} />
                          <button type="button" onClick={() => setQ1(p.id, String(Number(v || 0) + 1))}>+</button>
                        </div>
                      </td>
                      <td className={'num ' + (p.stock_qty !== null && Number(p.stock_qty) < 0 ? 'red' : '')}>{p.stock_qty !== null ? fmtQty(p.stock_qty) : '—'}</td>
                      <td className="num small">{money(p.purchase_price, p.currency)}</td>
                      <td className="num small">{sale ? money(sale, defPt.currency) : '—'}</td>
                    </tr>
                  )
                })}
                {rows && !rows.length && <tr><td colSpan={5} className="empty">{t('Topilmadi')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{chosen.length ? t('Tanlandi: {n} ta tovar', { n: chosen.length }) : t('Miqdorni kiriting yoki + bosing')}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary" disabled={!chosen.length} onClick={submit}><Icon name="check" size={16} /> {t('Tanlash')}</button>
        </span>
      </div>
    </Modal>
  )
}

/**
 * Pozitsiyalar jadvali (MoySklad: "Позиции").
 * lines: [{ key, product, name, code, unit, qty, price, discount_pct, stock }]
 */
export function Positions({ lines, setLines, currency, priceOf, readOnly, showStock = true, allowFree = true, extraRows, searchParams,
  showPrice = true, showDiscount = true, qtyLabel = 'Miqdor', stockLabel = 'Qoldiq', stockOf, warnShort = true, extraCols }) {
  const [picker, setPicker] = useState(false)
  const set = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const add = (p, n = 1) => {
    setLines((ls) => {
      const same = ls.find((l) => l.product && String(l.product) === String(p.id))
      if (same) return ls.map((l) => (l === same ? { ...l, qty: String(Number(l.qty || 0) + n) } : l))
      return [...ls, {
        key: newKey(), product: p.id, name: p.name, code: p.code || p.sku || '', unit: p.unit_display || '', qty: String(n),
        price: cleanNum(priceOf ? priceOf(p) : ''), discount_pct: '0', stock: stockOf ? stockOf(p) : p.stock_qty,
      }]
    })
  }
  const addFree = (name) => setLines((ls) => [...ls, { key: newKey(), product: null, name, code: '', unit: '', qty: '1', price: '', discount_pct: '0', stock: null }])
  const num = (v) => (v === '' || v === null || v === undefined ? '' : v)

  return (
    <div className="positions">
      <div className="table-wrap">
        <table className="t positions-t">
          <thead>
            <tr>
              <th style={{ width: 36 }}>№</th>
              <th>{t('Nomi')}</th>
              <th className="num" style={{ width: 120 }}>{t(qtyLabel)}</th>
              <th style={{ width: 70 }}>{t('Birlik')}</th>
              {showStock && <th className="num" style={{ width: 100 }}>{t(stockLabel)}</th>}
              {extraCols?.head}
              {showPrice && <th className="num" style={{ width: 140 }}>{t('Narx')}</th>}
              {showPrice && showDiscount && <th className="num" style={{ width: 90 }}>{t('Chegirma %')}</th>}
              {showPrice && <th className="num" style={{ width: 150 }}>{t('Summa')}</th>}
              {!readOnly && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {extraRows}
            {lines.map((l, i) => {
              const short = warnShort && showStock && l.stock !== null && l.stock !== undefined && Number(l.qty) > Number(l.stock)
              return (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {l.code && <b className="pos-code">{l.code}</b>}
                    {l.product || readOnly ? <span>{l.name}</span>
                      : <input className="cell" value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} />}
                  </td>
                  <td className="num">
                    {readOnly ? fmtQty(l.qty) : <NumInput className={'cell num' + (short ? ' warn' : '')} value={num(l.qty)} onChange={(e) => set(l.key, { qty: e.target.value })} title={short ? t('Qoldiq yetarli emas') : undefined} />}
                  </td>
                  <td className="muted small">{t(l.unit || '')}</td>
                  {showStock && <td className={'num small ' + (short ? 'red' : 'muted')}>{l.stock !== null && l.stock !== undefined ? fmtQty(l.stock) : '—'}</td>}
                  {extraCols?.cell(l)}
                  {showPrice && <td className="num">{readOnly ? money(l.price, currency) : <NumInput className="cell num" value={num(l.price)} onChange={(e) => set(l.key, { price: e.target.value })} />}</td>}
                  {showPrice && showDiscount && <td className="num">{readOnly ? `${Number(l.discount_pct || 0)}%` : <NumInput className="cell num" value={num(l.discount_pct)} onChange={(e) => set(l.key, { discount_pct: e.target.value })} />}</td>}
                  {showPrice && <td className="num bold">{money(lineAmount(l), currency)}</td>}
                  {!readOnly && <td className="num"><IconBtn icon="delete" danger title="O'chirish" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>}
                </tr>
              )
            })}
            {!lines.length && !extraRows && <tr><td colSpan={9} className="empty">{t("Pozitsiyalar yo'q — pastdagi qidiruv orqali qo'shing")}</td></tr>}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="positions-add">
          <ProductSearch onPick={add} onFree={allowFree ? addFree : null} params={searchParams} />
          <button type="button" className="btn" onClick={() => setPicker(true)}><Icon name="book" size={16} /> {t("Ma'lumotnomadan qo'shish")}</button>
        </div>
      )}
      {picker && <ProductPicker onPick={add} onClose={() => setPicker(false)} params={searchParams} />}
    </div>
  )
}

/** Pastki qism: chapda izoh, o'ngda jami */
export function DocFooter({ comment, onComment, rows }) {
  return (
    <div className="doc-footer">
      <textarea className="doc-comment" placeholder={t('Izoh')} value={comment || ''} onChange={(e) => onComment?.(e.target.value)} readOnly={!onComment} />
      <div className="doc-totals">
        {rows.map(([label, value, big], i) => (
          <div key={i} className={'row' + (big ? ' big' : '')}><span>{t(label)}:</span><b>{value}</b></div>
        ))}
      </div>
    </div>
  )
}

export function useLinesTotal(lines) {
  return useMemo(() => lines.reduce((a, l) => a + lineAmount(l), 0), [lines])
}

// "Yangi tovar" oynasi — hujjat pozitsiyalarida qidiruvdan to'g'ridan-to'g'ri tovar yaratish.
// Foydalanish: const p = await newProductDialog({ name: 'Profil' })  → yaratilgan tovar yoki null
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import api from '../api'
import { baseCurrency, getCurrencies } from '../currency'
import { localizeError } from '../errors'
import { t } from '../i18n'
import { NumInput } from './Inputs'

const TYPES = [['goods', 'Tovar (qayta sotish)'], ['product', 'Tayyor mahsulot'], ['raw', 'Xomashyo / material'], ['service', 'Xizmat']]
const UNITS = [['pcs', 'dona'], ['m', 'm'], ['m2', 'm²'], ['kg', 'kg'], ['set', "to'plam"]]

function Dialog({ initial, done }) {
  const base = baseCurrency()
  const [v, setV] = useState({ name: initial.name || '', type: initial.type || 'goods', unit: 'pcs', sku: '', barcode: '', group: '',
    currency: base, purchase_price: '', sale_price: '' })
  const [groups, setGroups] = useState([])
  const [priceType, setPriceType] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)
  useEffect(() => {
    nameRef.current?.focus()
    api.get('/warehouse/groups/').then(({ data }) => setGroups(data.results || data)).catch(() => {})
    api.get('/warehouse/price-types/').then(({ data }) => {
      const list = data.results || data
      setPriceType(list.find((p) => p.is_default) || list[0] || null)
    }).catch(() => {})
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null) } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = { name: v.name.trim(), type: v.type, unit: v.unit, sku: v.sku, barcode: v.barcode, group: v.group || null,
      currency: v.currency, purchase_price: v.purchase_price || 0, min_price_currency: v.currency, is_active: true,
      ...(priceType && v.sale_price !== '' ? { prices: { [priceType.id]: v.sale_price } } : {}) }
    try {
      const { data } = await api.post('/warehouse/products/', body)
      done(data)
    } catch (err) { setError(localizeError(err)); setBusy(false) }
  }
  return (
    <div className="modal-back confirm-back create-back" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 680 }}>
        <div className="modal-head"><h2 style={{ margin: 0 }}>{t('Yangi tovar')}</h2>
          <button className="x" type="button" onClick={() => done(null)} aria-label={t('Yopish')}>×</button></div>
        {error && <div className="error">{error}</div>}
        <form className="form" onSubmit={save}>
          <div className="field full"><label>{t('Nomi')} *</label><input ref={nameRef} value={v.name} required onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>{t('Turi')}</label>
            <select value={v.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          <div className="field"><label>{t('Birlik')}</label>
            <select value={v.unit} onChange={(e) => set('unit', e.target.value)}>{UNITS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          <div className="field"><label>{t('Artikul')}</label><input value={v.sku} onChange={(e) => set('sku', e.target.value)} /></div>
          <div className="field"><label>{t('Shtrix-kod')}</label><input value={v.barcode} onChange={(e) => set('barcode', e.target.value)} /></div>
          {groups.length > 0 && (
            <div className="field span2"><label>{t('Guruh')}</label>
              <select value={v.group} onChange={(e) => set('group', e.target.value)}>
                <option value="">{t('— guruhsiz —')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></div>
          )}
          <div className="field"><label>{t('Valyuta')}</label>
            <select value={v.currency} onChange={(e) => set('currency', e.target.value)}>
              {getCurrencies().filter((c) => c.is_active).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select></div>
          {v.type !== 'service' && <div className="field"><label>{t('Xarid narxi (tannarx)')}</label><NumInput value={v.purchase_price} placeholder="0" onChange={(e) => set('purchase_price', e.target.value)} /></div>}
          {priceType && <div className="field"><label>{t('Sotuv narxi')} ({priceType.name})</label><NumInput value={v.sale_price} placeholder="0" onChange={(e) => set('sale_price', e.target.value)} /></div>}
          <p className="hint full" style={{ margin: 0 }}>{t("Kod avtomatik beriladi. Qolgan ma'lumotlarni keyin Tovarlar bo'limida to'ldirasiz.")}</p>
          <div className="full form-actions">
            <button type="button" className="btn" onClick={() => done(null)}>{t('Bekor')}</button>
            <button className="btn primary" disabled={busy || !v.name.trim()}>{t('Yaratish va qo\'shish')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** → Promise<tovar | null> */
export function newProductDialog(initial = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<Dialog initial={initial} done={done} />)
  })
}

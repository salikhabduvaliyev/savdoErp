// Sotuv hujjati — MoySklad "Отгрузка" uslubida
import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { cleanNum, DocField, DocFooter, DocPage, DocTitle, newKey, Positions, useLinesTotal } from '../../components/DocEditor'
import Icon from '../../components/Icon'
import { Badge, useFetch } from '../../components/ui'
import { money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import { curLabel, CurrencyOptions } from '../../currency'

const cur = curLabel

export default function SaleForm({ sale, onClose, onSaved }) {
  const clients = useFetch('/crm/counterparties/', { is_active: true })
  const warehouses = useFetch('/warehouse/warehouses/')
  const priceTypes = useFetch('/warehouse/price-types/')
  const fromOrder = !!sale?.order
  const [v, setV] = useState(() => ({
    client: sale?.client || '', warehouse: sale?.warehouse || '', price_type: sale?.price_type || '',
    currency: sale?.currency || 'UZS', date: sale?.date || todayISO(), discount: sale?.discount || '0', note: sale?.note || '',
  }))
  const orderLines = (sale?.items || []).filter((i) => i.order)
  const [lines, setLines] = useState(() => (sale?.items || []).filter((i) => !i.order).map((i) => ({
    key: newKey(), product: i.product, name: i.name, code: '', unit: i.unit, qty: cleanNum(i.qty), price: cleanNum(i.price),
    discount_pct: cleanNum(i.discount_pct), stock: null,
  })))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const setF = (k, val) => { setV((s) => ({ ...s, [k]: val })); setDirty(true) }
  const setL = (fn) => { setLines(fn); setDirty(true) }

  // standart narx turi va ombor
  useEffect(() => {
    if (!sale && priceTypes.data && !v.price_type) {
      const def = priceTypes.data.find((p) => p.is_default) || priceTypes.data[0]
      if (def) setV((s) => ({ ...s, price_type: def.id, currency: def.currency }))
    }
  }, [priceTypes.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sale && warehouses.data?.length && !v.warehouse) setV((s) => ({ ...s, warehouse: warehouses.data[0].id }))
  }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const priceOf = (p) => (v.price_type ? p.prices?.[v.price_type] ?? '' : '')
  const changePriceType = (ptId) => {
    const pt = (priceTypes.data || []).find((p) => String(p.id) === String(ptId))
    setV((s) => ({ ...s, price_type: ptId, currency: fromOrder ? s.currency : pt?.currency || s.currency }))
    setDirty(true)
  }
  const pickClient = (id) => {
    const c = (clients.data || []).find((x) => String(x.id) === String(id))
    setF('client', id)
    if (c?.price_type && !fromOrder) changePriceType(c.price_type)
  }

  const own = useLinesTotal(lines)
  const subtotal = orderLines.reduce((a, l) => a + Number(l.amount), 0) + own
  const total = subtotal - Number(v.discount || 0)

  const submit = async (complete) => {
    setBusy(true)
    setError(null)
    const items = lines.filter((l) => l.product || l.name?.trim()).map((l) => ({
      product: l.product || null, name: l.name, qty: l.qty, price: l.price || 0, discount_pct: l.discount_pct || 0,
    }))
    const payload = { ...v, warehouse: v.warehouse || null, price_type: v.price_type || null, items }
    try {
      const { data } = sale ? await api.patch(`/sales/${sale.id}/`, payload) : await api.post('/sales/', payload)
      if (complete) await api.post(`/sales/${data.id}/complete/`)
      onSaved(data.id, complete)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const close = () => { if (!dirty || window.confirm(tr("Saqlanmagan o'zgarishlar bor. Yopilsinmi?"))) onClose() }
  const ok = !busy && v.client

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button type="button" className="btn primary" disabled={!ok} onClick={() => submit(false)}><Icon name="save" size={16} /> {busy ? tr('Saqlanmoqda…') : tr('Saqlash')}</button>
        <button type="button" className="btn success" disabled={!ok} onClick={() => submit(true)}><Icon name="check" size={16} /> {tr('Saqlash va yakunlash')}</button>
        <button type="button" className="btn" onClick={close}>{tr('Yopish')}</button>
        <span className="grow" />
        {dirty && <span className="small muted">{tr("Saqlanmagan o'zgarishlar")}</span>}
      </>}
    >
      <DocTitle label="Sotuv" number={sale?.number} date={v.date} onDate={(d) => setF('date', d)}>
        <Badge kind="draft">{tr('Qoralama')}</Badge>
      </DocTitle>
      {error && <div className="error">{error}</div>}
      {fromOrder && <div className="hint" style={{ marginBottom: 10 }}>{tr('Buyurtma asosida:')} <b>№{sale.order_number}</b></div>}

      <div className="doc-grid">
        <div>
          <DocField label="Mijoz" required>
            <select value={v.client} onChange={(e) => pickClient(e.target.value)} disabled={fromOrder}>
              <option value="">{tr('— tanlang —')}</option>
              {(clients.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
            </select>
          </DocField>
        </div>
        <div>
          <DocField label="Ombor" required>
            <select value={v.warehouse ?? ''} onChange={(e) => setF('warehouse', e.target.value)}>
              <option value="">—</option>
              {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </DocField>
          <DocField label="Narx turi">
            <select value={v.price_type ?? ''} onChange={(e) => changePriceType(e.target.value)}>
              <option value="">—</option>
              {(priceTypes.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({cur(p.currency)})</option>)}
            </select>
          </DocField>
        </div>
        <div>
          <DocField label="Valyuta" required>
            <select value={v.currency} onChange={(e) => setF('currency', e.target.value)} disabled={fromOrder}>
              <CurrencyOptions withName value={v.currency} />
            </select>
          </DocField>
        </div>
      </div>

      <div className="doc-tabs"><span className="active">{tr('Pozitsiyalar')}</span></div>
      <Positions
        lines={lines} setLines={setL} currency={v.currency} priceOf={priceOf} searchParams={{ for_sale: 1 }}
        extraRows={orderLines.length ? orderLines.map((l) => (
          <tr key={'o' + l.id} className="locked-row">
            <td className="muted">—</td>
            <td><b>{l.name}</b> <span className="small muted">{tr('(buyurtmadan)')}</span></td>
            <td className="num">{qty(l.qty)}</td><td className="muted small">{tr(l.unit)}</td><td />
            <td className="num">{money(l.price, v.currency)}</td><td />
            <td className="num bold">{money(l.amount, v.currency)}</td><td />
          </tr>
        )) : null}
      />

      <DocFooter
        comment={v.note}
        onComment={(note) => setF('note', note)}
        rows={[
          ['Oraliq jami', money(subtotal, v.currency)],
          ['Chegirma', <input key="d" className="cell num" style={{ width: 140 }} inputMode="decimal" value={v.discount} onChange={(e) => setF('discount', e.target.value)} />],
          ["To'lanadi", money(total, v.currency), true],
        ]}
      />
    </DocPage>
  )
}

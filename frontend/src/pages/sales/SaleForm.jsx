// Sotuv hujjati — MoySklad "Отгрузка" uslubida
import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { cleanNum, DocField, DocFooter, DocPage, DocTitle, newKey, Positions, useLinesTotal } from '../../components/DocEditor'
import Icon from '../../components/Icon'
import { Badge, useFetch } from '../../components/ui'
import { money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import { convertPrice, curLabel, CurrencyOptions, baseCurrency } from '../../currency'
import { SearchSelect } from '../../components/Controls'
import { confirmDialog } from '../../components/Confirm'
import { NumInput } from '../../components/Inputs'
import { newCounterpartyDialog } from '../../components/NewCounterparty'
import PartyBalance from '../../components/PartyBalance'
import { useFieldConfig } from '../../components/FieldConfig'

const cur = curLabel

/* order berilsa — buyurtmadan yangi sotuv: qiymatlar buyurtmadan (o'zgartirish mumkin), qoralamasiz — saqlanganda o'tkaziladi */
export default function SaleForm({ sale, order, onClose, onSaved }) {
  const clients = useFetch('/crm/counterparties/', { is_active: true, with_debt: 1 })
  const warehouses = useFetch('/warehouse/warehouses/')
  const priceTypes = useFetch('/warehouse/price-types/')
  const fc = useFieldConfig('sale')
  const fromOrder = !!sale?.order || !!order
  const [v, setV] = useState(() => (order ? {
    client: order.client, warehouse: '', price_type: '', currency: order.currency, date: todayISO(), discount: '0',
    note: tr('Buyurtma №{n} asosida', { n: order.number }),
  } : {
    client: sale?.client || '', warehouse: sale?.warehouse || '', price_type: sale?.price_type || '',
    currency: sale?.currency || baseCurrency(), date: sale?.date || todayISO(), discount: sale?.discount || '0', note: sale?.note || '',
  }))
  const orderLines = (sale?.items || []).filter((i) => i.order)
  const [lines, setLines] = useState(() => (order ? order.items : (sale?.items || []).filter((i) => !i.order)).map((i) => ({
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
    if (!sale && !order && priceTypes.data && !v.price_type) {
      const def = priceTypes.data.find((p) => p.is_default) || priceTypes.data[0]
      if (def) setV((s) => ({ ...s, price_type: def.id, currency: def.currency }))
    }
  }, [priceTypes.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sale && warehouses.data?.length && !v.warehouse) setV((s) => ({ ...s, warehouse: warehouses.data[0].id }))
  }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // narx turi valyutasidagi narx → hujjat valyutasiga (joriy kurs)
  const ptCur = (id) => (priceTypes.data || []).find((p) => String(p.id) === String(id))?.currency
  const priceOf = (p) => {
    const raw = v.price_type ? p.prices?.[v.price_type] : null
    return raw === null || raw === undefined || raw === '' ? '' : convertPrice(raw, ptCur(v.price_type), v.currency)
  }
  const changeCurrency = (to) => {
    setLines((ls) => ls.map((l) => ({ ...l, price: l.price === '' ? '' : String(convertPrice(l.price, v.currency, to)) })))
    setF('currency', to)
  }
  const changePriceType = (ptId) => {
    const pt = (priceTypes.data || []).find((p) => String(p.id) === String(ptId))
    const to = fromOrder ? v.currency : pt?.currency || v.currency
    if (to !== v.currency) setLines((ls) => ls.map((l) => ({ ...l, price: l.price === '' ? '' : String(convertPrice(l.price, v.currency, to)) })))
    setV((s) => ({ ...s, price_type: ptId, currency: to }))
    setDirty(true)
  }
  const pickClient = (id) => {
    const c = (clients.data || []).find((x) => String(x.id) === String(id))
    setF('client', id)
    if (c?.price_type && !fromOrder) changePriceType(c.price_type)
  }

  const client = (clients.data || []).find((c) => String(c.id) === String(v.client))
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
      if (order) {
        const { data } = await api.post('/sales/from_order/', { ...payload, order: order.id, complete: true })
        onSaved(data.id, true)
        return
      }
      const { data } = sale ? await api.patch(`/sales/${sale.id}/`, payload) : await api.post('/sales/', payload)
      if (complete) await api.post(`/sales/${data.id}/complete/`)
      onSaved(data.id, complete)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const close = async () => { if (!dirty || await confirmDialog(tr("Saqlanmagan o'zgarishlar bor. Yopilsinmi?"))) onClose() }
  const ok = !busy && v.client

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button type="button" className="btn primary" disabled={!ok || (order && !lines.length)} onClick={() => submit(!!order)}><Icon name="save" size={16} /> {busy ? tr('Saqlanmoqda…') : tr('Saqlash')}</button>
        {!order && <button type="button" className="btn success" disabled={!ok} onClick={() => submit(true)}><Icon name="check" size={16} /> {tr('Saqlash va yakunlash')}</button>}
        <button type="button" className="btn" onClick={close}>{tr('Yopish')}</button>
        <span className="grow" />
        {dirty && <span className="small muted">{tr("Saqlanmagan o'zgarishlar")}</span>}
      </>}
    >
      <DocTitle label="Sotuv" number={sale?.number} date={v.date} onDate={(d) => setF('date', d)}>
        {!order && <Badge kind="draft">{tr('Qoralama')}</Badge>}
      </DocTitle>
      {error && <div className="error">{error}</div>}
      {fromOrder && <div className="hint" style={{ marginBottom: 10 }}>{tr('Buyurtma asosida:')} <b>№{order ? order.number : sale.order_number}</b>{order && <> · {tr("qiymatlarni o'zgartirish mumkin; saqlanganda sotuv o'tkaziladi (tovar ombordan chiqadi)")}</>}</div>}

      <div className="doc-grid">
        <div>
          <DocField label="Mijoz" required>
            <SearchSelect value={v.client} onChange={(id) => pickClient(id)} disabled={fromOrder} placeholder={tr('Mijozni tanlang…')}
              options={(clients.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.phone }))}
              onCreate={async (name) => {
                const cp = await newCounterpartyDialog({ name, group: 'Mijozlar' })
                if (!cp) return
                await clients.reload(); pickClient(cp.id)
              }} createLabel={tr('Yangi mijoz')} />
            {v.client && <PartyBalance counterparty={v.client} currency={v.currency} />}
          </DocField>
          {client && (
            <div className="party-card">
              {client.phone && <div><Icon name="user" size={14} /> {client.phone}</div>}
              {client.price_type_name && <div className="muted small">{tr('Narx turi')}: {client.price_type_name}</div>}
            </div>
          )}
        </div>
        <div>
          <DocField label="Ombor" required>
            <SearchSelect value={v.warehouse ?? ''} onChange={(id) => setF('warehouse', id)} options={(warehouses.data || []).map((w) => ({ value: w.id, label: w.name }))} />
          </DocField>
          {!fc.hidden('price_type') && <DocField label={fc.label('price_type', 'Narx turi')}>
            <SearchSelect value={v.price_type ?? ''} onChange={(id) => changePriceType(id)} empty="—"
              options={(priceTypes.data || []).map((p) => ({ value: p.id, label: p.name, sub: cur(p.currency) }))} />
          </DocField>}
        </div>
        <div>
          <DocField label="Valyuta" required>
            <select value={v.currency} onChange={(e) => changeCurrency(e.target.value)} disabled={fromOrder}>
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
          !fc.hidden('discount') && [fc.label('discount', 'Chegirma'), <NumInput key="d" className="cell num" style={{ width: 140 }} value={v.discount} onChange={(e) => setF('discount', e.target.value)} />],
          ["To'lanadi", money(total, v.currency), true],
        ].filter(Boolean)}
      />
    </DocPage>
  )
}

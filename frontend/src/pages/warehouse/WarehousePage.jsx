import { useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorText } from '../../api'
import { Badge, Field, Loading, Modal, MoneyBag, useFetch, useForm } from '../../components/ui'
import { date, money, qty, todayISO } from '../../format'
import { t } from '../../i18n'
import { curLabel } from '../../currency'

const TYPE_LABEL = { in: 'Kirim', out: 'Chiqim', transfer: "Ichki o'tkazma", adjust: 'Inventarizatsiya' }

function MoveForm({ type, onClose, onSaved }) {
  const { values, bind } = useForm({ date: todayISO(), type, material: '', warehouse: '', to_warehouse: '', qty: '', price: '', supplier: '', order: '', note: '' })
  const [error, setError] = useState(null)
  const materials = useFetch('/warehouse/products/', { type: 'raw,product,goods', is_active: true })
  const warehouses = useFetch('/warehouse/warehouses/')
  const suppliers = useFetch('/crm/counterparties/', { role: 'supplier', is_active: true })
  const orders = useFetch('/orders/', { status: 'confirmed,in_production' })
  const mat = (materials.data || []).find((m) => String(m.id) === String(values.material))

  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...values }
    for (const k of ['to_warehouse', 'supplier', 'order', 'price']) if (!payload[k]) delete payload[k]
    try {
      await api.post('/warehouse/moves/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }

  return (
    <Modal title={TYPE_LABEL[type]} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label={t("Material")} full>
          <select {...bind('material')} required>
            <option value="">{t("— tanlang —")}</option>
            {(materials.data || []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit_display})</option>)}
          </select>
        </Field>
        <Field label={t("Sana")}><input type="date" {...bind('date')} /></Field>
        <Field label={type === 'transfer' ? 'Qaysi ombordan' : 'Ombor'}>
          <select {...bind('warehouse')} required>
            <option value="">{t("— tanlang —")}</option>
            {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        {type === 'transfer' && (
          <Field label={t("Qaysi omborga")}>
            <select {...bind('to_warehouse')} required>
              <option value="">{t("— tanlang —")}</option>
              {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={`Miqdor${mat ? `, ${mat.unit_display}` : ''}${type === 'adjust' ? ' (farq: + yoki −)' : ''}`}>
          <input type="number" step="0.001" {...bind('qty')} required />
        </Field>
        {type === 'in' && (
          <>
            <Field label={`Narx (${curLabel(mat?.currency)} / birlik)`}><input type="number" step="0.0001" min="0" {...bind('price')} required /></Field>
            <Field label={t("Yetkazuvchi (kreditor qarzi hisoblanadi)")}>
              <select {...bind('supplier')}>
                <option value="">—</option>
                {(suppliers.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </>
        )}
        {type === 'out' && (
          <Field label={t("Buyurtma (rezervdan yechiladi)")}>
            <select {...bind('order')}>
              <option value="">—</option>
              {(orders.data?.results || []).map((o) => <option key={o.id} value={o.id}>{o.number} · {o.client_name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("Izoh")} full><input {...bind('note')} /></Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

function Stocks({ stamp }) {
  const [f, setF] = useState({ warehouse: '', material__group: '', below_min: '' })
  const warehouses = useFetch('/warehouse/warehouses/')
  const groups = useFetch('/warehouse/groups/')
  const params = Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/warehouse/stock/', params)
  return (
    <div className="table-wrap">
      <div className="table-toolbar filters">
        <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
          <option value="">{t("Ombor: hammasi")}</option>
          {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={f.material__group} onChange={(e) => setF({ ...f, material__group: e.target.value })}>
          <option value="">{t("Guruh: hammasi")}</option>
          {(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className={'chip' + (f.below_min ? ' on' : '')} onClick={() => setF({ ...f, below_min: f.below_min ? '' : 'true' })}>{t("Faqat minimaldan past")}</button>
      </div>
      {!data ? <Loading error={error} /> : (
        <table className="t">
          <thead><tr><th>{t("Material")}</th><th>{t("Birlik")}</th><th>{t("Ombor")}</th><th className="num">{t("Qoldiq")}</th><th className="num">{t("Rezerv")}</th><th className="num">{t("Mavjud")}</th><th className="num">{t("Minimal")}</th><th className="num">{t("O'rtacha narx")}</th><th className="num">{t("Qiymati")}</th><th>{t("Holat")}</th></tr></thead>
          <tbody>
            {data.results.map((s) => (
              <tr key={s.id}>
                <td>{s.material_name}</td>
                <td>{s.unit}</td>
                <td>{s.warehouse_name}</td>
                <td className="num">{qty(s.qty)}</td>
                <td className="num">{qty(s.reserved)}</td>
                <td className="num bold">{qty(s.available)}</td>
                <td className="num">{qty(s.min_qty)}</td>
                <td className="num">{money(s.avg_cost, s.currency)}</td>
                <td className="num">{money(s.value, s.currency)}</td>
                <td><Badge kind={s.state}>{s.state_display}</Badge></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={8}>{t("Qoldiq qiymati (valyuta bo'yicha alohida)")}</td><td className="num"><MoneyBag bag={data.total_value} /></td><td /></tr>
          </tfoot>
        </table>
      )}
      <div className="hint" style={{ padding: '0 12px 10px' }}>{t("Holat: mavjud ≤ minimal → \"Kam\"; mavjud ≤ minimal × 1,2 → \"Minimalga yaqin\".")}</div>
    </div>
  )
}

function Moves({ type, stamp }) {
  const { data, error } = useFetch('/warehouse/moves/', { ...(type ? { type } : {}), stamp })
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{t("Sana")}</th><th>{t("Turi")}</th><th>{t("Material")}</th><th>{t("Ombor")}</th><th className="num">{t("Miqdor")}</th><th className="num">{t("Narx")}</th><th className="num">{t("Summa")}</th><th>{t("Kontragent / buyurtma")}</th><th>{t("Izoh")}</th></tr></thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id}>
              <td>{date(m.date)}</td>
              <td>{m.type_display}</td>
              <td>{m.material_name}</td>
              <td>{m.warehouse_name}{m.to_warehouse_name && ` → ${m.to_warehouse_name}`}</td>
              <td className="num">{qty(m.qty)} {m.unit}</td>
              <td className="num">{money(m.price, m.currency)}</td>
              <td className="num">{money(m.amount, m.currency)}</td>
              <td>{m.supplier_name}{m.order && <Link to={`/orders/${m.order}`}>#{m.order_number}</Link>}</td>
              <td className="small muted">{m.note}</td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={9} className="empty">{t("Harakatlar yo'q")}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function WarehousePage() {
  const [tab, setTab] = useState('stock')
  const [form, setForm] = useState(null)
  const [stamp, setStamp] = useState(0)
  const tabs = [['stock', t("Qoldiqlar")], ['in', t("Kirim")], ['out', t("Chiqim")], ['transfer', t("O'tkazmalar")], ['adjust', t("Inventarizatsiya")]]
  return (
    <>
      <div className="page-head">
        <h1>{t("Ombor")}</h1>
        <button className="btn primary" onClick={() => setForm('in')}>{t("+ Kirim")}</button>
        <button className="btn" onClick={() => setForm('out')}>{t("Chiqim")}</button>
        <button className="btn" onClick={() => setForm('transfer')}>{t("Ichki o'tkazma")}</button>
        <button className="btn" onClick={() => setForm('adjust')}>{t("Inventarizatsiya")}</button>
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'stock' ? <Stocks stamp={stamp} /> : <Moves type={tab} stamp={stamp} />}
      {form && <MoveForm type={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1) }} />}
    </>
  )
}

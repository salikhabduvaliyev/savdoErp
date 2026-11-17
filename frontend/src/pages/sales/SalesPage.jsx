import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { can, canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { Drawer } from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import Icon, { IconBtn } from '../../components/Icon'

const STATUSES = [['draft', tr("Qoralama")], ['completed', tr("Yakunlangan")], ['cancelled', tr("Bekor qilingan")]]
const cur = (c) => (c === 'USD' ? 'USD' : "so'm")

/* ------------------------------------------------------------ forma */
function emptyLine() {
  return { key: Math.random(), product: '', name: '', qty: '1', price: '', discount_pct: '0' }
}

function lineAmount(l) {
  const a = Number(l.qty || 0) * Number(l.price || 0) * (1 - Number(l.discount_pct || 0) / 100)
  return Math.round(a * 100) / 100
}

export function SaleForm({ sale, onClose, onSaved }) {
  const clients = useFetch('/crm/counterparties/', { role: 'client', is_active: true })
  const warehouses = useFetch('/warehouse/warehouses/')
  const priceTypes = useFetch('/warehouse/price-types/')
  const products = useFetch('/warehouse/products/', { for_sale: 1, is_active: true })
  const fromOrder = !!sale?.order
  const [v, setV] = useState(() => ({
    client: sale?.client || '', warehouse: sale?.warehouse || '', price_type: sale?.price_type || '',
    currency: sale?.currency || 'UZS', date: sale?.date || todayISO(), discount: sale?.discount || '0', note: sale?.note || '',
  }))
  const orderLines = (sale?.items || []).filter((i) => i.order)
  const [lines, setLines] = useState(() => {
    const own = (sale?.items || []).filter((i) => !i.order).map((i) => ({ ...i, key: i.id, product: i.product || '' }))
    return own.length || fromOrder ? own : [emptyLine()]
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

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

  const prodById = useMemo(() => Object.fromEntries((products.data || []).map((p) => [String(p.id), p])), [products.data])
  const priceOf = (p, ptId) => (p?.prices?.[ptId] ?? '')

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickProduct = (key, id) => {
    const p = prodById[id]
    setLine(key, { product: id, name: p?.name || '', price: priceOf(p, v.price_type) })
  }
  const changePriceType = (ptId) => {
    const pt = (priceTypes.data || []).find((p) => String(p.id) === String(ptId))
    setV((s) => ({ ...s, price_type: ptId, currency: fromOrder ? s.currency : pt?.currency || s.currency }))
    setLines((ls) => ls.map((l) => (l.product ? { ...l, price: priceOf(prodById[l.product], ptId) || l.price } : l)))
  }
  const pickClient = (id) => {
    const c = (clients.data || []).find((x) => String(x.id) === String(id))
    setV((s) => ({ ...s, client: id }))
    if (c?.price_type && !fromOrder) changePriceType(c.price_type)
  }

  const subtotal = orderLines.reduce((a, l) => a + Number(l.amount), 0) + lines.reduce((a, l) => a + lineAmount(l), 0)
  const total = subtotal - Number(v.discount || 0)

  const submit = async (complete) => {
    setBusy(true)
    setError(null)
    const items = lines.filter((l) => l.product || l.name).map((l) => ({
      product: l.product || null, name: l.name, qty: l.qty, price: l.price || 0, discount_pct: l.discount_pct || 0,
    }))
    const payload = { ...v, warehouse: v.warehouse || null, price_type: v.price_type || null, items }
    try {
      const { data } = sale ? await api.patch(`/sales/${sale.id}/`, payload) : await api.post('/sales/', payload)
      if (complete) await api.post(`/sales/${data.id}/complete/`)
      onSaved(data.id, complete)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  return (
    <Modal title={sale ? `Sotuv №${sale.number}` : 'Yangi sotuv'} onClose={onClose} wide>
      {error && <div className="error">{error}</div>}
      <div className="form three">
        <Field label={tr("Mijoz")}>
          <select value={v.client} onChange={(e) => pickClient(e.target.value)} disabled={fromOrder} required>
            <option value="">{tr("— tanlang —")}</option>
            {(clients.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
          </select>
        </Field>
        <Field label={tr("Sana")}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label={tr("Ombor (tovar chiqadi)")}>
          <select value={v.warehouse ?? ''} onChange={(e) => setV({ ...v, warehouse: e.target.value })}>
            <option value="">—</option>
            {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={tr("Narx turi")}>
          <select value={v.price_type ?? ''} onChange={(e) => changePriceType(e.target.value)}>
            <option value="">—</option>
            {(priceTypes.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({cur(p.currency)})</option>)}
          </select>
        </Field>
        <Field label={tr("Valyuta")}>
          <select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} disabled={fromOrder}>
            <option value="UZS">{tr("so'm")}</option><option value="USD">USD</option>
          </select>
        </Field>
        <Field label={tr("Izoh")}><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="t">
          <thead><tr><th style={{ width: '40%' }}>{tr("Tovar / xizmat")}</th><th className="num">{tr("Miqdor")}</th><th className="num">{tr("Narx")}</th><th className="num">{tr("Chegirma %")}</th><th className="num">{tr("Summa")}</th><th /></tr></thead>
          <tbody>
            {orderLines.map((l) => (
              <tr key={l.id}>
                <td><b>{l.name}</b> <span className="small muted">{tr("(buyurtmadan)")}</span></td>
                <td className="num">{qty(l.qty)}</td><td className="num">{money(l.price, v.currency)}</td><td />
                <td className="num bold">{money(l.amount, v.currency)}</td><td />
              </tr>
            ))}
            {lines.map((l) => {
              const p = prodById[String(l.product)]
              return (
                <tr key={l.key}>
                  <td>
                    <select className="cell" value={l.product ?? ''} onChange={(e) => pickProduct(l.key, e.target.value)}>
                      <option value="">{tr("— tovar tanlang —")}</option>
                      {(products.data || []).map((x) => (
                        <option key={x.id} value={x.id}>{x.name}{x.stock_qty !== null ? ` · qoldiq ${qty(x.stock_qty)}` : ''}</option>
                      ))}
                    </select>
                    {p && p.stock_qty !== null && Number(l.qty) > Number(p.stock_qty) && <div className="small red">Qoldiq yetarli emas ({qty(p.stock_qty)})</div>}
                  </td>
                  <td className="num"><input className="cell" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} style={{ width: 80 }} /></td>
                  <td className="num"><input className="cell" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} style={{ width: 120 }} /></td>
                  <td className="num"><input className="cell" value={l.discount_pct} onChange={(e) => setLine(l.key, { discount_pct: e.target.value })} style={{ width: 70 }} /></td>
                  <td className="num bold">{money(lineAmount(l), v.currency)}</td>
                  <td className="num"><IconBtn icon="delete" danger title="O\'chirish" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="table-toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
          <button type="button" className="btn small" onClick={() => setLines((ls) => [...ls, emptyLine()])}>{tr("+ Qator")}</button>
        </div>
      </div>

      <div className="totals-box" style={{ marginTop: 14 }}>
        <span className="muted">{tr("Jami:")}</span><span className="num">{money(subtotal, v.currency)}</span>
        <span className="muted">{tr("Chegirma:")}</span>
        <span className="num"><input className="cell" value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} style={{ width: 130 }} /></span>
        <span className="big">{tr("To'lanadi:")}</span><span className="num big">{money(total, v.currency)}</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onClose}>{tr("Bekor")}</button>
        <button type="button" className="btn" disabled={busy || !v.client} onClick={() => submit(false)}>{tr("Qoralama sifatida saqlash")}</button>
        <button type="button" className="btn primary" disabled={busy || !v.client} onClick={() => submit(true)}>{tr("Saqlash va yakunlash")}</button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ to'lov */
function PayForm({ sale, onClose, onSaved }) {
  const accounts = useFetch('/finance/accounts/')
  const [v, setV] = useState({ account: '', amount: String(Number(sale.debt) || ''), date: todayISO(), description: '' })
  const [error, setError] = useState(null)
  const acc = (accounts.data || []).find((a) => String(a.id) === String(v.account))
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/sales/${sale.id}/pay/`, v)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={`Sotuv №${sale.number}: to'lov qabul qilish`} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <p className="muted" style={{ marginTop: 0 }}>{tr("Qarz:")} <b className="red">{money(sale.debt, sale.currency)}</b></p>
      <form className="form" onSubmit={submit}>
        <Field label={tr("Kassa / hisob")}>
          <select value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })} required>
            <option value="">{tr("— tanlang —")}</option>
            {(accounts.data || []).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label={`Summa${acc ? ` (${cur(acc.currency)})` : ''}`}><input type="number" step="any" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required /></Field>
        <Field label={tr("Sana")}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label={tr("Izoh")}><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        {acc && acc.currency !== sale.currency && <p className="hint full">{tr("Hisob valyutasi sotuv valyutasidan farq qiladi — summa to'lov sanasidagi kurs bo'yicha aylantiriladi.")}</p>}
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{tr("Bekor")}</button>
          <button className="btn primary">{tr("Qabul qilish")}</button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------ karta */
function SaleCard({ id, onClose, onChanged }) {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data: s, error } = useFetch(`/sales/${id}/`, { stamp })
  const pays = useFetch(`/sales/${id}/payments/`, { stamp })
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(false)
  if (!s) return <Drawer onClose={onClose}><Loading error={error} /></Drawer>
  const refresh = () => { setStamp((x) => x + 1); onChanged() }
  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    try {
      await api.post(`/sales/${id}/${action}/`)
      toast(action === 'complete' ? 'Sotuv yakunlandi' : 'Sotuv bekor qilindi')
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }
  const remove = async () => {
    if (!window.confirm("Qoralama o'chirilsinmi?")) return
    try { await api.delete(`/sales/${id}/`); onChanged(); onClose() } catch (e) { toast(errorText(e), true) }
  }
  const editable = canEdit(user, 'sales')

  return (
    <Drawer onClose={onClose}>
      <div className="page-head">
        <div>
          <h1>Sotuv №{s.number}</h1>
          <div className="page-sub">{date(s.date)} · {s.client_name}{s.branch_name ? ` · ${s.branch_name}` : ''}{s.seller_name ? ` · sotuvchi: ${s.seller_name}` : ''}</div>
        </div>
        <Badge kind={s.status}>{s.status_display}</Badge>
        <span className="grow" />
        {s.status === 'draft' && editable && <button className="btn icon-only" onClick={() => setEdit(true)} title={tr("Tahrirlash")}><Icon name="edit" size={16} /></button>}
        {s.status === 'draft' && editable && <button className="btn primary" onClick={() => act('complete')}>{tr("Yakunlash")}</button>}
        {s.status !== 'cancelled' && editable && Number(s.debt) > 0 && <button className="btn success" onClick={() => setPay(true)}>{tr("To'lov qabul qilish")}</button>}
        <button className="btn" onClick={onClose}><Icon name="back" size={16} /> {tr("Orqaga")}</button>
      </div>
      {s.order && <div className="card" style={{ marginBottom: 12 }}>{tr("Buyurtma asosida:")} <Link to={`/orders/${s.order}`}>№{s.order_number}</Link> {tr("— buyurtmaga oldin to'langan avanslar shu sotuv to'loviga hisoblangan.")}</div>}
      <div className="stats">
        <Stat label={tr("Summa")} value={money(s.total, s.currency)} />
        <Stat label={tr("To'langan")} value={money(s.paid, s.currency)} valueClass="green" />
        <Stat label={s.status === 'completed' ? 'Qarz' : "To'lanishi kerak"} value={money(s.status === 'completed' ? s.debt : Number(s.total) - Number(s.paid), s.currency)}
          valueClass={Number(s.debt) > 0 ? 'red' : ''} />
        {s.cost !== null && can(user, 'finance') && <Stat label={tr("Tannarx · foyda")} value={money(s.cost, s.currency)} sub={`Foyda: ${money(Number(s.total) - Number(s.cost), s.currency)}`} />}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Tovar / xizmat")}</th><th className="num">{tr("Miqdor")}</th><th className="num">{tr("Narx")}</th><th className="num">{tr("Chegirma")}</th><th className="num">{tr("Summa")}</th></tr></thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}{i.order && <span className="small muted"> {tr("(buyurtma)")}</span>}</td>
                <td className="num">{qty(i.qty)} {i.unit}</td>
                <td className="num">{money(i.price, s.currency)}</td>
                <td className="num">{Number(i.discount_pct) ? `${qty(i.discount_pct)}%` : '—'}</td>
                <td className="num bold">{money(i.amount, s.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Number(s.discount) > 0 && <tr><td colSpan={4}>{tr("Chegirma")}</td><td className="num">− {money(s.discount, s.currency)}</td></tr>}
            <tr><td colSpan={4}>{tr("Jami")}</td><td className="num">{money(s.total, s.currency)}</td></tr>
          </tfoot>
        </table>
      </div>
      <h2 style={{ marginTop: 18 }}>{tr("To'lovlar")}</h2>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Sana")}</th><th>{tr("Hisob")}</th><th>{tr("Izoh")}</th><th className="num">{tr("Summa")}</th></tr></thead>
          <tbody>
            {(pays.data || []).map((t) => (
              <tr key={t.id}><td>{date(t.date)}</td><td>{t.account_name}</td><td>{t.description}</td>
                <td className="num green">{money(t.amount, t.currency, { sign: true })}</td></tr>
            ))}
            {pays.data && !pays.data.length && <tr><td colSpan={4} className="empty">{tr("To'lovlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        {s.status === 'draft' && canDelete(user, 'sales') && <button className="btn" onClick={remove}>{tr("Qoralamani o'chirish")}</button>}
        {s.status !== 'cancelled' && editable && (
          <button className="btn" onClick={() => act('cancel', "Sotuv bekor qilinsinmi? Tovarlar omborga qaytariladi.")}>{tr("Sotuvni bekor qilish")}</button>
        )}
      </div>
      {edit && <SaleForm sale={s} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); toast('Saqlandi') }} />}
      {pay && <PayForm sale={s} onClose={() => setPay(false)} onSaved={() => { setPay(false); refresh(); toast("To'lov qabul qilindi") }} />}
    </Drawer>
  )
}

/* ------------------------------------------------------------ sahifa */
export default function SalesPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ search: '', status: '', currency: '', date_from: '', date_to: '' })
  const [form, setForm] = useState(false)
  const openId = params.get('open')
  const q = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== '')), [f, stamp])
  const { data, error } = useFetch('/sales/', q)
  const refresh = () => setStamp((s) => s + 1)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr("Sotuvlar")}</h1>
          <div className="page-sub">{tr("Tovar sotish va tayyor buyurtmalarni realizatsiya qilish")}</div>
        </div>
        <span className="grow" />
        {canCreate(user, 'sales') && <button className="btn primary" onClick={() => setForm(true)}>{tr("+ Sotuv")}</button>}
      </div>
      {data && (
        <div className="stats">
          <Stat label={tr("Sotuvlar (yakunlangan)")} bag={data.totals.total} />
          <Stat label={tr("To'langan")} bag={data.totals.paid} />
          <Stat label={tr("Qarz")} bag={data.totals.debt} />
        </div>
      )}
      <div className="table-wrap">
        <div className="table-toolbar filters">
          <input placeholder={tr("Raqam yoki mijoz…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
          <input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">{tr("Status: hammasi")}</option>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option value="">{tr("Valyuta: hammasi")}</option><option value="UZS">{tr("so'm")}</option><option value="USD">USD</option>
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>№</th><th>{tr("Sana")}</th><th>{tr("Mijoz")}</th><th>{tr("Asos")}</th><th className="num">{tr("Summa")}</th><th className="num">{tr("To'langan")}</th><th className="num">{tr("Qarz")}</th><th>{tr("Status")}</th><th>{tr("Sotuvchi")}</th></tr></thead>
            <tbody>
              {data.results.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setParams({ open: s.id })}>
                  <td className="bold">{s.number}</td>
                  <td>{date(s.date)}</td>
                  <td>{s.client_name}</td>
                  <td className="small">{s.order ? `Buyurtma №${s.order_number}` : <span className="muted">{s.warehouse_name || '—'}</span>}</td>
                  <td className="num">{money(s.total, s.currency)}</td>
                  <td className="num">{money(s.paid, s.currency)}</td>
                  <td className={'num ' + (Number(s.debt) > 0 ? 'red bold' : 'muted')}>{Number(s.debt) ? money(s.debt, s.currency) : '—'}</td>
                  <td><Badge kind={s.status}>{s.status_display}</Badge></td>
                  <td className="small">{s.seller_name || '—'}</td>
                </tr>
              ))}
              {!data.results.length && <tr><td colSpan={9} className="empty">{tr("Sotuvlar yo'q")}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>{tr("Jami (yakunlanganlar, valyuta bo'yicha)")}</td>
                <td className="num"><MoneyBag bag={data.totals.total} /></td>
                <td className="num"><MoneyBag bag={data.totals.paid} /></td>
                <td className="num"><MoneyBag bag={data.totals.debt} /></td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        )}
      </div>
      {form && <SaleForm onClose={() => setForm(false)} onSaved={(id, done) => { setForm(false); refresh(); setParams({ open: id }); toast(done ? 'Sotuv yakunlandi' : 'Qoralama saqlandi') }} />}
      {openId && <SaleCard id={openId} onClose={() => setParams({})} onChanged={refresh} />}
    </>
  )
}

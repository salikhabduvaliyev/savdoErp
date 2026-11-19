import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { can, canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { Drawer } from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import SaleForm from './SaleForm'
import { BulkMenu, SearchSelect, usePager } from '../../components/Controls'
import { DocList } from '../warehouse/StockDocs'
import Icon, { IconBtn } from '../../components/Icon'
import { curLabel, CurrencyOptions } from '../../currency'

const STATUSES = [['draft', tr("Qoralama")], ['completed', tr("Yakunlangan")], ['cancelled', tr("Bekor qilingan")]]
const cur = curLabel

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
  const navigate = useNavigate()
  const makeReturn = async () => {
    try {
      const { data } = await api.post('/warehouse/docs/from_sale/?type=sales_return', { sale: id })
      navigate(`/sales/returns?open=${data.id}`)
    } catch (e) { toast(errorText(e), true) }
  }
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
        {s.status === 'completed' && canCreate(user, 'sales') && (
          <button className="btn" onClick={makeReturn}><Icon name="back" size={15} /> {tr('Mijoz qaytarishi')}</button>
        )}
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
function SalesList() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [stamp, setStamp] = useState(0)
  const empty = { search: '', status: '', currency: '', date_from: '', date_to: '', client: '', seller: '', warehouse: '' }
  const [f, setF] = useState(empty)
  const [showFilter, setShowFilter] = useState(false)
  const [form, setForm] = useState(false)
  const [selected, setSelected] = useState([])
  const openId = params.get('open')
  const q = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== '')), [f, stamp])
  const { data, error } = useFetch('/sales/', q)
  const clients = useFetch(showFilter ? '/crm/counterparties/' : null, { is_active: true })
  const users = useFetch(showFilter ? '/auth/users-lookup/' : null)
  const warehouses = useFetch(showFilter ? '/warehouse/warehouses/' : null)
  const refresh = () => setStamp((s) => s + 1)
  const { rows: pageRows, pager } = usePager(data?.results, 50, JSON.stringify(q))
  const toggleRow = (id) => setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const bulk = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    try {
      const { data: r } = await api.post('/sales/bulk/', { ids: selected, action })
      if (r.errors?.length) toast(r.errors.join('\n'), true)
      if (r.done) toast(tr('Bajarildi: {n} ta', { n: r.done }))
      setSelected([])
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tr("Sotuvlar")}</h1>
          <div className="page-sub">{tr("Tovar sotish va tayyor buyurtmalarni realizatsiya qilish")}</div>
        </div>
        <span className="grow" />
        {canCreate(user, 'sales') && <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" size={16} /> {tr("Sotuv")}</button>}
        <button className={'btn' + (showFilter ? ' active' : '')} onClick={() => setShowFilter((x) => !x)}><Icon name="filter" size={15} /> {tr('Filtr')}</button>
        <div className="psearch" style={{ maxWidth: 320, minWidth: 220 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={tr("Raqam, mijoz yoki izoh")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
      </div>
      {showFilter && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{tr('Davr')}
              <div className="inline-pick"><input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />—<input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></div>
            </label>
            <label>{tr('Mijoz')}
              <SearchSelect value={f.client} onChange={(v) => setF({ ...f, client: v })} empty={tr('hammasi')}
                options={(clients.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.phone }))} />
            </label>
            <label>{tr('Status')}
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="">{tr('hammasi')}</option>
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>{tr('Valyuta')}
              <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="">{tr('hammasi')}</option><CurrencyOptions /></select>
            </label>
            <label>{tr('Sotuvchi')}
              <SearchSelect value={f.seller} onChange={(v) => setF({ ...f, seller: v })} empty={tr('hammasi')}
                options={(users.data || []).map((u) => ({ value: u.id, label: u.full_name }))} />
            </label>
            <label>{tr('Ombor')}
              <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
                <option value="">{tr('hammasi')}</option>
                {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          </div>
          <div className="filter-actions"><span className="grow" /><button className="btn small" onClick={() => setF(empty)}>{tr('Tozalash')}</button></div>
        </div>
      )}
      {data && (
        <div className="stats">
          <Stat label={tr("Sotuvlar (yakunlangan)")} bag={data.totals.total} />
          <Stat label={tr("To'langan")} bag={data.totals.paid} />
          <Stat label={tr("Qarz")} bag={data.totals.debt} />
        </div>
      )}
      <div className="table-wrap">
        <div className="table-toolbar">
          <b>{tr('Hammasi')} {data?.count ?? ''}</b>
          <BulkMenu count={selected.length} items={[
            { label: tr('Yakunlash (o\'tkazish)'), onClick: () => bulk('complete') },
            { label: tr('Bekor qilish'), onClick: () => bulk('cancel', tr('Tanlangan sotuvlar bekor qilinsinmi? Tovarlar omborga qaytadi.')) },
            { divider: true },
            { label: tr("O'chirish (qoralamalar)"), danger: true, onClick: () => bulk('delete', tr("Tanlangan qoralamalar o'chirilsinmi?")) },
          ]} />
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th style={{ width: 30 }}><input type="checkbox" checked={!!data.results.length && selected.length === data.results.length}
              onChange={(e) => setSelected(e.target.checked ? data.results.map((x) => x.id) : [])} /></th><th>№</th><th>{tr("Sana")}</th><th>{tr("Mijoz")}</th><th>{tr("Asos")}</th><th className="num">{tr("Summa")}</th><th className="num">{tr("To'langan")}</th><th className="num">{tr("Qarz")}</th><th>{tr("Status")}</th><th>{tr("Sotuvchi")}</th></tr></thead>
            <tbody>
              {pageRows.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setParams({ open: s.id })}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggleRow(s.id)} /></td>
                  <td className="bold"><span className="link-like">{s.number}</span></td>
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
              {!data.results.length && <tr><td colSpan={10} className="empty">{tr("Sotuvlar yo'q")}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>{tr("Jami (yakunlanganlar, valyuta bo'yicha)")}</td>
                <td className="num"><MoneyBag bag={data.totals.total} /></td>
                <td className="num"><MoneyBag bag={data.totals.paid} /></td>
                <td className="num"><MoneyBag bag={data.totals.debt} /></td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        )}
        {pager}
      </div>
      {form && <SaleForm onClose={() => setForm(false)} onSaved={(id, done) => { setForm(false); refresh(); setParams({ open: id }); toast(done ? 'Sotuv yakunlandi' : 'Qoralama saqlandi') }} />}
      {openId && <SaleCard id={openId} onClose={() => setParams({})} onChanged={refresh} />}
    </>
  )
}

// MoySklad "Продажи": Sotuvlar (Отгрузки) · Mijoz qaytarishlari. Buyurtmalar — alohida bo'lim.
const TABS = [['list', tr('Sotuvlar')], ['returns', tr('Mijoz qaytarishlari')]]

export default function SalesPage() {
  const { tab: tabParam } = useParams()
  const nav = useNavigate()
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam : 'list'
  return (
    <>
      <div className="tabs section-tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => nav(k === 'list' ? '/sales' : `/sales/${k}`)}>{l}</button>)}
      </div>
      {tab === 'list' ? <SalesList /> : <DocList type="sales_return" />}
    </>
  )
}

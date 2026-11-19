import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { can, canCreate, canDelete, canEdit, canPost, useAuth } from '../../auth'
import { Drawer } from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import SaleForm from './SaleForm'
import Profitability from './Profitability'
import { PaymentDoc } from '../finance/Payments'
import { printReceipt, printWaybill } from '../../components/Print'
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
/* Sotuv kartasi (MoySklad "Отгрузка"): o'tkazish, tahrirlash, o'chirish, yaratish (to'lov, qaytarish), pechat, bog'liq hujjatlar */
function Drop({ label, icon, items }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bulk" onMouseLeave={() => setOpen(false)}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>{icon && <Icon name={icon} size={16} />} {label} <Icon name="chevron-down" size={14} /></button>
      {open && <div className="bulk-menu">{items.filter(Boolean).map(([l, fn, dis]) => <button key={l} className="bulk-item" disabled={dis} onClick={() => { setOpen(false); fn() }}>{l}</button>)}</div>}
    </div>
  )
}

function RelatedDocs({ s, pays, rets }) {
  const card = (kind, title, num, d, sum, cur, to, status) => (
    <Link to={to} className={'rel-card ' + kind}>
      <div className="rel-title">{status === 'ok' ? '✓ ' : ''}{title}</div>
      <div>№{num}</div>{d && <div className="muted small">{date(d)}</div>}{sum != null && <b>{money(sum, cur)}</b>}
    </Link>
  )
  return (
    <div className="rel-flow">
      {s.order && <>{card('order', tr('Buyurtma'), s.order_number, null, null, s.currency, `/orders/${s.order}`, 'ok')}<span className="rel-arrow">→</span></>}
      <div className="rel-card current"><div className="rel-title">{s.status === 'completed' ? '✓ ' : ''}{tr('Sotuv')}</div><div>№{s.number}</div>
        <div className="muted small">{date(s.date)}</div><b>{money(s.total, s.currency)}</b><div className="rel-status">{tr(s.status_display)}</div></div>
      {(pays.length > 0 || rets.length > 0) && <span className="rel-arrow">→</span>}
      <div className="rel-col">
        {pays.map((x) => card('pay', tr(x.doc_type || (x.account_kind === 'bank' ? "Kiruvchi to'lov" : 'Kirim orderi')), String(x.number || '').padStart(5, '0'), x.date, x.amount, x.currency, '/finance', 'ok'))}
        {rets.map((x) => card('ret', tr('Mijoz qaytarishi'), String(x.number).padStart(5, '0'), x.date, x.total, x.currency, `/sales/returns?open=${x.id}`, x.posted ? 'ok' : ''))}
      </div>
      {!s.order && !pays.length && !rets.length && <p className="muted">{tr("Bog'liq hujjatlar yo'q")}</p>}
    </div>
  )
}

function SaleCard({ id, onClose, onChanged }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stamp, setStamp] = useState(0)
  const { data: s, error } = useFetch(`/sales/${id}/`, { stamp })
  const pays = useFetch(`/sales/${id}/payments/`, { stamp })
  const rets = useFetch('/warehouse/docs/', { type: 'sales_return', sale: id, stamp })
  const [tab, setTab] = useState('main')
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(null)
  if (!s) return <Drawer onClose={onClose}><Loading error={error} /></Drawer>
  const refresh = () => { setStamp((x) => x + 1); onChanged() }
  const post = async (on) => {
    try {
      await api.post(`/sales/${id}/${on ? 'complete' : 'unpost'}/`)
      toast(on ? tr("O'tkazildi") : tr("O'tkazish bekor qilindi — qoralama"))
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }
  const makeReturn = async () => {
    try {
      const { data } = await api.post('/warehouse/docs/from_sale/?type=sales_return', { sale: id })
      navigate(`/sales/returns?open=${data.id}`)
    } catch (e) { toast(errorText(e), true) }
  }
  const remove = async () => {
    const msg = tr("Sotuv o'chirilsinmi?") + (s.status === 'completed' ? '\n' + tr('Tovarlar omborga qaytariladi.') : '') + (Number(s.paid) > 0 ? '\n' + tr("To'lovlar o'chirilmaydi — mijozning avansi bo'lib qoladi.") : '')
    if (!window.confirm(msg)) return
    try { await api.delete(`/sales/${id}/`); toast(tr("O'chirildi")); onChanged(); onClose() } catch (e) { toast(errorText(e), true) }
  }
  const editable = canEdit(user, 'sales') && s.status !== 'cancelled'
  const posted = s.status === 'completed'
  const returns = rets.data?.results || []

  return (
    <Drawer onClose={onClose}>
      <div className="doc-toolbar">
        {editable && <button className="btn primary" onClick={() => setEdit(true)}><Icon name="edit" size={16} /> {tr('Tahrirlash')}</button>}
        <button className="btn" onClick={onClose}>{tr('Yopish')}</button>
        <Drop label={tr('Yaratish')} icon="plus" items={[
          canCreate(user, 'finance') && Number(s.debt) > 0 && [tr('Kirim orderi (kassa)'), () => setPay('cash')],
          canCreate(user, 'finance') && Number(s.debt) > 0 && [tr("Kiruvchi to'lov (bank)"), () => setPay('bank')],
          posted && canCreate(user, 'sales_returns') && [tr('Mijoz qaytarishi'), makeReturn],
          [tr('Nusxa (yangi sotuv)'), async () => {
            try {
              const { data } = await api.post('/sales/', { client: s.client, warehouse: s.warehouse, currency: s.currency, price_type: s.price_type,
                items: s.items.filter((i) => !i.order).map((i) => ({ product: i.product, name: i.name, qty: i.qty, price: i.price, discount_pct: i.discount_pct })) })
              toast(tr('Nusxa yaratildi: №{n}', { n: data.number })); onChanged(); navigate(`/sales?open=${data.id}`)
            } catch (e) { toast(errorText(e), true) }
          }, !canCreate(user, 'sales')],
        ]} />
        <Drop label={tr('Pechat')} icon="print" items={[[tr('Yuk xati (nakladnoy)'), () => printWaybill(s)], [tr('Tovar cheki'), () => printReceipt(s)]]} />
        <span className="grow" />
        {s.status !== 'cancelled' && (
          <label className="check posted-check" title={tr("Belgilansa — tovar ombordan chiqadi")}>
            <input type="checkbox" checked={posted} disabled={!canPost(user, 'sales')} onChange={(e) => post(e.target.checked)} /> {tr("O'tkazilgan")}
          </label>
        )}
        {canDelete(user, 'sales') && <button className="icon-act danger" title={tr("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
      </div>

      <div className="doc-titlebar">
        <h1>{tr('Sotuv')} №{s.number}</h1><span className="doc-from">{tr('dan')} {date(s.date)}</span>
        <Badge kind={s.status}>{tr(s.status_display)}</Badge>
        {Number(s.debt) > 0 ? <Badge kind="low">{tr("To'lanmagan")}: {money(s.debt, s.currency)}</Badge> : posted && <Badge kind="ok">{tr("To'langan")}</Badge>}
      </div>
      <div className="doc-grid" style={{ marginBottom: 12 }}>
        <div><div className="kv-line"><span>{tr('Mijoz')}</span><b>{s.client_name}</b></div><div className="kv-line"><span>{tr('Sotuvchi')}</span><b>{s.seller_name || '—'}</b></div></div>
        <div><div className="kv-line"><span>{tr('Ombor')}</span><b>{s.warehouse_name || '—'}</b></div><div className="kv-line"><span>{tr('Filial')}</span><b>{s.branch_name || '—'}</b></div></div>
        <div>
          <div className="kv-line"><span>{tr('Valyuta')}</span><b>{curLabel(s.currency)}</b></div>
          {s.order && <div className="kv-line"><span>{tr('Asos')}</span><Link to={`/orders/${s.order}`}>{tr('Buyurtma')} №{s.order_number}</Link></div>}
        </div>
      </div>

      <div className="doc-tabs">
        <span className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')} style={{ cursor: 'pointer' }}>{tr('Asosiy')}</span>
        <span className={tab === 'rel' ? 'active' : ''} onClick={() => setTab('rel')} style={{ cursor: 'pointer' }}>{tr("Bog'liq hujjatlar")} ({(pays.data || []).length + returns.length + (s.order ? 1 : 0)})</span>
      </div>

      {tab === 'main' ? (
        <>
          <div className="positions">
            <div className="table-wrap">
              <table className="t positions-t">
                <thead><tr><th style={{ width: 36 }}>№</th><th>{tr('Tovar / xizmat')}</th><th className="num">{tr('Miqdor')}</th><th className="num">{tr('Narx')}</th><th className="num">{tr('Chegirma')}</th><th className="num">{tr('Summa')}</th>
                  {posted && can(user, 'finance') && <th className="num">{tr('Tannarx')}</th>}</tr></thead>
                <tbody>
                  {s.items.map((i, n) => (
                    <tr key={i.id}>
                      <td className="muted">{n + 1}</td>
                      <td>{i.name}{i.order && <span className="small muted"> {tr('(buyurtma)')}</span>}</td>
                      <td className="num">{qty(i.qty)} {tr(i.unit || '')}</td>
                      <td className="num">{money(i.price, s.currency)}</td>
                      <td className="num">{Number(i.discount_pct) ? `${qty(i.discount_pct)}%` : '—'}</td>
                      <td className="num bold">{money(i.amount, s.currency)}</td>
                      {posted && can(user, 'finance') && <td className="num muted">{money(i.cost_amount, s.currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="doc-footer">
            <div>
              <h3 style={{ margin: '0 0 8px' }}>{tr("To'lovlar")}</h3>
              <div className="table-wrap">
                <table className="t compact">
                  <tbody>
                    {(pays.data || []).map((x) => (
                      <tr key={x.id}><td>{date(x.date)}</td><td>{x.account_name}</td><td className="small muted">{x.description}</td><td className="num green">{money(x.amount, x.currency, { sign: true })}</td></tr>
                    ))}
                    {pays.data && !pays.data.length && <tr><td className="empty">{tr("To'lovlar yo'q")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="doc-totals">
              {Number(s.discount) > 0 && <div className="row"><span>{tr('Chegirma')}:</span><b>− {money(s.discount, s.currency)}</b></div>}
              <div className="row"><span>{tr("To'langan")}:</span><b className="green">{money(s.paid, s.currency)}</b></div>
              {posted && s.cost !== null && can(user, 'finance') && <div className="row"><span>{tr('Foyda')}:</span><b>{money(Number(s.total) - Number(s.cost), s.currency)}</b></div>}
              <div className="row big"><span>{tr('Jami')}:</span><b>{money(s.total, s.currency)}</b></div>
            </div>
          </div>
        </>
      ) : <RelatedDocs s={s} pays={pays.data || []} rets={returns} />}

      {edit && <SaleForm sale={s} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); toast(tr('Saqlandi')) }} />}
      {pay && <PaymentDoc direction="in" accountKind={pay} presetSale={s} onClose={() => setPay(null)} onSaved={() => { setPay(null); refresh() }} />}
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
            { label: tr("O'tkazishni bekor qilish"), onClick: () => bulk('unpost', tr('Tanlangan sotuvlar qoralamaga qaytarilsinmi? Tovarlar omborga qaytadi.')) },
            { divider: true },
            { label: tr("O'chirish"), danger: true, onClick: () => bulk('delete', tr("Tanlangan sotuvlar o'chirilsinmi? Tovarlar omborga qaytadi, to'lovlar avans bo'lib qoladi.")) },
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
const TABS = [['list', tr('Sotuvlar')], ['returns', tr('Mijoz qaytarishlari')], ['profit', tr('Foydalilik')]]

export default function SalesPage() {
  const { tab: tabParam } = useParams()
  const nav = useNavigate()
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam : 'list'
  return (
    <>
      <div className="tabs section-tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => nav(k === 'list' ? '/sales' : `/sales/${k}`)}>{l}</button>)}
      </div>
      {tab === 'list' ? <SalesList /> : tab === 'profit' ? <Profitability /> : <DocList type="sales_return" />}
    </>
  )
}

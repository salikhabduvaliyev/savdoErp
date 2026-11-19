import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { money, monthLabel, shortDate } from '../../format'
import TransactionForm from './TransactionForm'
import { t as tr } from '../../i18n'
import { CurrencyOptions, curLabel } from '../../currency'
import Icon from '../../components/Icon'

function Transactions({ stamp, direction }) {
  const [f, setF] = useState({ date_from: '', date_to: '', account: '', unassigned: '' })
  const accounts = useFetch('/finance/accounts/')
  const params = Object.fromEntries(Object.entries({ ...f, direction, stamp }).filter(([, v]) => v))
  const { data, error } = useFetch('/finance/transactions/', params)
  return (
    <div className="table-wrap">
      <div className="table-toolbar filters">
        <input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
        <input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        <select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
          <option value="">{tr("Hisob: hammasi")}</option>
          {(accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className={'chip' + (f.unassigned ? ' on' : '')} onClick={() => setF({ ...f, unassigned: f.unassigned ? '' : 'true' })}>{tr("Biriktirilmagan")}</button>
      </div>
      {!data ? <Loading error={error} /> : (
        <table className="t">
          <thead><tr><th>{tr("Sana")}</th><th>{tr("Izoh / kontragent")}</th><th>{tr("Turi")}</th><th>{tr("Buyurtma")}</th><th>{tr("Hisob")}</th><th>{tr("Valyuta")}</th><th className="num">{tr("Summa")}</th></tr></thead>
          <tbody>
            {data.results.map((t) => (
              <tr key={t.id}>
                <td>{shortDate(t.date)}</td>
                <td>{[t.counterparty, t.description || t.category_name].filter(Boolean).join(' — ')}</td>
                <td className="small muted">{tr(t.kind_display)}</td>
                <td>{t.order ? <Link to={`/orders/${t.order}`}>{t.order_number}</Link> : (t.kind === 'expense' ? <span className="badge b-near_min">{tr("Biriktirilmagan")}</span> : '—')}</td>
                <td>{t.account_name}</td>
                <td>{curLabel(t.currency)}</td>
                <td className={'num ' + (t.direction === 'in' ? 'green' : 'red')}>{money(t.direction === 'in' ? t.amount : -t.amount, t.currency, { sign: true })}</td>
              </tr>
            ))}
            {!data.results.length && <tr><td colSpan={7} className="empty">{tr("Harakatlar yo'q")}</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan={5}>{tr("Kirim / chiqim")}</td><td /><td className="num"><span className="green"><MoneyBag bag={data.in} /></span><span className="red"><MoneyBag bag={data.out} /></span></td></tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

function Debts({ kind }) {
  const { data, error } = useFetch(kind === 'clients' ? '/finance/client-debts/' : '/finance/supplier-debts/')
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{kind === 'clients' ? 'Mijoz' : 'Yetkazuvchi'}</th><th className="num">{tr("Qarz (so'm)")}</th><th className="num">{tr("Qarz (USD)")}</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.client || r.supplier}>
              <td>{r.name}</td>
              <td className={'num ' + (Number(r.debt.UZS) < 0 ? 'green' : '')}>{Number(r.debt.UZS) ? money(r.debt.UZS, 'UZS') : '—'}</td>
              <td className={'num ' + (Number(r.debt.USD) < 0 ? 'green' : '')}>{Number(r.debt.USD) ? money(r.debt.USD, 'USD') : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>{tr("Jami")}</td><td className="num">{money(data.total.UZS, 'UZS')}</td><td className="num">{money(data.total.USD, 'USD')}</td></tr></tfoot>
      </table>
      {kind === 'suppliers' && <div className="hint" style={{ padding: '0 12px 10px' }}>{tr("Kreditor = ombor kirimlari (yetkazuvchi ko'rsatilgan) − yetkazuvchiga to'lovlar. Manfiy — avans.")}</div>}
    </div>
  )
}

/* MoySklad "Прибыли и убытки": bitta hisobot valyutasida, moddalar bo'yicha */
const iso = (d) => d.toISOString().slice(0, 10)
function periodOf(kind) {
  const now = new Date()
  const to = iso(now)
  if (kind === 'day') return { date_from: to, date_to: to }
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { date_from: iso(d), date_to: to } }
  if (kind === 'month') return { date_from: to.slice(0, 8) + '01', date_to: to }
  if (kind === 'quarter') { const m = Math.floor(now.getMonth() / 3) * 3; return { date_from: `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`, date_to: to } }
  return { date_from: `${now.getFullYear()}-01-01`, date_to: to }
}

function Pnl() {
  const [period, setPeriod] = useState(() => periodOf('month'))
  const [currency, setCurrency] = useState('UZS')
  const [open, setOpen] = useState({ revenue: true, opex: true, other: true })
  const { data, error } = useFetch('/finance/pnl/', { ...period, currency })
  const groupOf = (rows, i) => { for (let j = i; j >= 0; j--) if (rows[j].level === 0) return rows[j].key; return null }
  return (
    <>
      <div className="filter-panel card">
        <div className="pnl-filter">
          <label>{tr('Davr')}
            <div className="period-links">
              {[['day', tr('bugun')], ['week', tr('hafta')], ['month', tr('oy')], ['quarter', tr('chorak')], ['year', tr('yil')]].map(([k, l], i) => (
                <span key={k}>{i > 0 && '·'}<button type="button" className="link-btn" onClick={() => setPeriod(periodOf(k))}>{l}</button></span>
              ))}
            </div>
            <div className="inline-pick">
              <input type="date" value={period.date_from} onChange={(e) => setPeriod({ ...period, date_from: e.target.value })} />—
              <input type="date" value={period.date_to} onChange={(e) => setPeriod({ ...period, date_to: e.target.value })} />
            </div>
          </label>
          <label>{tr('Hisobot valyutasi')}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}><CurrencyOptions withName value={currency} /></select>
          </label>
        </div>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          {data.warnings?.length > 0 && <div className="error">{data.warnings.join('; ')}</div>}
          <div className="pnl-wrap">
            <table className="t pnl-t">
              <thead><tr><th>{tr('Modda')}</th><th className="num">{tr('Foyda (zarar)')}, {curLabel(data.currency)}</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const grp = r.level ? groupOf(data.rows, i) : null
                  if (r.level && !open[grp]) return null
                  const hasKids = !r.level && data.rows[i + 1]?.level === 1
                  const neg = Number(r.amount) < 0
                  return (
                    <tr key={r.key} className={(r.bold ? 'bold ' : '') + (r.total ? 'pnl-total ' : '') + (r.grand ? 'pnl-grand ' : '') + (r.level ? 'pnl-sub' : '')}>
                      <td style={{ paddingLeft: r.level ? 36 : 14 }}>
                        {hasKids
                          ? <button className="link-btn pnl-toggle" onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}><Icon name={open[r.key] ? 'chevron-down' : 'chevron-right'} size={14} /> {tr(r.label)}</button>
                          : tr(r.label)}
                      </td>
                      <td className={'num ' + (neg ? 'red' : '')}>{money(r.amount, data.currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="pnl-side">
              <Stat label={tr('Yalpi rentabellik')} value={data.gross_margin_pct !== null ? `${data.gross_margin_pct}%` : '—'} sub={tr('yalpi foyda / tushum')} />
              <Stat label={tr('Sof rentabellik')} value={data.net_margin_pct !== null ? `${data.net_margin_pct}%` : '—'}
                valueClass={Number(data.net_margin_pct) < 0 ? 'red' : 'green'} sub={tr('sof foyda / tushum')} />
            </div>
          </div>
          <p className="hint">{tr("Har bir summa o'z sanasidagi kurs bo'yicha hisobot valyutasiga aylantiriladi. Operatsion xarajatlar — buyurtmaga biriktirilmagan va \"foydaga ta'sir qiladi\" belgilangan moddalar. Buyurtmaga biriktirilgan xarajatlar tannarx ichida.")}</p>
        </>
      )}
    </>
  )
}

function CashFlow() {
  const { data, error } = useFetch('/finance/cash-flow/', { date_from: `${new Date().getFullYear()}-01-01` })
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{tr("Oy")}</th><th className="num">{tr("Kirim")}</th><th className="num">{tr("Chiqim")}</th><th className="num">{tr("Sof oqim")}</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.month}>
              <td>{monthLabel(r.month)}</td>
              <td className="num green"><MoneyBag bag={r.in} /></td>
              <td className="num red"><MoneyBag bag={r.out} /></td>
              <td className="num bold"><MoneyBag bag={r.net} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function FinancePage() {
  const [tab, setTab] = useState('tx')
  const [form, setForm] = useState(null)
  const [stamp, setStamp] = useState(0)
  const accounts = useFetch('/finance/accounts/', { stamp })
  const tabs = [['tx', tr("To'lovlar")], ['exp', tr("Xarajatlar")], ['clients', tr("Mijozlar qarzi")], ['suppliers', tr("Yetkazuvchilar qarzi")], ['pnl', tr("Foyda va zarar")], ['cf', tr("Pul oqimi")]]
  return (
    <>
      <div className="page-head">
        <h1>{tr("Moliya")}</h1>
        <button className="btn primary" onClick={() => setForm('client_payment')}>{tr("+ Kirim")}</button>
        <button className="btn" onClick={() => setForm('supplier_payment')}>{tr("Chiqim")}</button>
        <button className="btn" onClick={() => setForm('expense')}>{tr("Xarajat")}</button>
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {['tx', 'exp'].includes(tab) && accounts.data && (
        <div className="stats">
          {accounts.data.filter((a) => a.is_active).map((a) => (
            <Stat key={a.id} label={a.name} value={money(a.balance, a.currency)} valueClass={a.currency === 'USD' ? 'usd' : ''} />
          ))}
        </div>
      )}
      {tab === 'tx' && <Transactions stamp={stamp} />}
      {tab === 'exp' && <Transactions stamp={stamp} direction="out" />}
      {tab === 'clients' && <Debts kind="clients" />}
      {tab === 'suppliers' && <Debts kind="suppliers" />}
      {tab === 'pnl' && <Pnl />}
      {tab === 'cf' && <CashFlow />}
      {form && <TransactionForm kind={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />}
    </>
  )
}

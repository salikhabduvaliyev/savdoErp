import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { money, monthLabel, shortDate, todayISO } from '../../format'
import TransactionForm from './TransactionForm'
import { t as tr } from '../../i18n'

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
                <td>{t.currency === 'USD' ? 'USD' : "so'm"}</td>
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

function Pnl() {
  const [period, setPeriod] = useState({ date_from: `${new Date().getFullYear()}-01-01`, date_to: todayISO() })
  const { data, error } = useFetch('/finance/pnl/', period)
  const rows = [['revenue', tr("Tushum (buyurtmalar)")], ['cost', tr("Tannarx (smeta A+B+C+D)")], ['gross_profit', tr("Yalpi foyda")], ['overhead', tr("Ustama xarajatlar (biriktirilmagan)")], ['net_profit', tr("Sof foyda")]]
  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <input type="date" value={period.date_from} onChange={(e) => setPeriod({ ...period, date_from: e.target.value })} />
        <input type="date" value={period.date_to} onChange={(e) => setPeriod({ ...period, date_to: e.target.value })} />
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{tr("Ko'rsatkich")}</th><th className="num">{tr("so'm")}</th><th className="num">USD</th></tr></thead>
            <tbody>
              {rows.map(([k, l]) => (
                <tr key={k} className={k.includes('profit') ? 'bold' : ''}>
                  <td>{l}</td>
                  <td className={'num ' + (Number(data[k].UZS) < 0 ? 'red' : '')}>{money(data[k].UZS, 'UZS')}</td>
                  <td className={'num ' + (Number(data[k].USD) < 0 ? 'red' : '')}>{money(data[k].USD, 'USD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ padding: '0 12px 10px' }}>{tr("Ustunlar — buyurtma valyutasi bo'yicha. USD buyurtmaning so'mdagi xarajatlari kurs bo'yicha USD ustunida.")}</div>
        </div>
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

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { money, monthLabel } from '../../format'
import TransactionForm from './TransactionForm'
import Payments from './Payments'
import { t as tr } from '../../i18n'
import { CurrencyOptions, curLabel, baseCurrency } from '../../currency'
import Icon from '../../components/Icon'

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
  const [currency, setCurrency] = useState(baseCurrency)
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
  const tabs = [['tx', tr("To'lovlar")], ['clients', tr("Mijozlar qarzi")], ['suppliers', tr("Yetkazuvchilar qarzi")], ['pnl', tr("Foyda va zarar")], ['cf', tr("Pul oqimi")]]
  return (
    <>
      <div className="page-head">
        <h1>{tr("Pul")}</h1>
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'tx' && <Payments />}
      {tab === 'clients' && <Debts kind="clients" />}
      {tab === 'suppliers' && <Debts kind="suppliers" />}
      {tab === 'pnl' && <Pnl />}
      {tab === 'cf' && <CashFlow />}
      {form && <TransactionForm kind={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast('Saqlandi') }} />}
    </>
  )
}

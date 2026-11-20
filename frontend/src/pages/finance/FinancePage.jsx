import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { date, money, monthLabel } from '../../format'
import TransactionForm from './TransactionForm'
import Payments from './Payments'
import { Adjustments, Settlements } from './Settlements'
import { t as tr } from '../../i18n'
import { CurrencyOptions, curLabel, baseCurrency } from '../../currency'
import Icon from '../../components/Icon'
import { DateInput } from '../../components/Inputs'

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
              <DateInput value={period.date_from} onChange={(e) => setPeriod({ ...period, date_from: e.target.value })} />—
              <DateInput value={period.date_to} onChange={(e) => setPeriod({ ...period, date_to: e.target.value })} />
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

/* MoySklad "Движение денежных средств": tanlangan davr ichida kunlik (yoki oylik) */
function CashFlow() {
  const [period, setPeriod] = useState(() => periodOf('month'))
  const [group, setGroup] = useState('day')
  const [account, setAccount] = useState('')
  const accounts = useFetch('/finance/accounts/')
  const { data, error } = useFetch('/finance/cash-flow/', { ...period, group, account: account || undefined })
  const label = (r) => (group === 'month' ? monthLabel(r.month) : date(r.key))
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
              <DateInput value={period.date_from} onChange={(e) => setPeriod({ ...period, date_from: e.target.value })} />—
              <DateInput value={period.date_to} onChange={(e) => setPeriod({ ...period, date_to: e.target.value })} />
            </div>
          </label>
          <label>{tr('Hisob (kassa/bank)')}
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">{tr('Hammasi')}</option>
              {(accounts.data?.results || accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>{tr('Guruhlash')}
            <div className="segmented">
              <button type="button" className={group === 'day' ? 'active' : ''} onClick={() => setGroup('day')}>{tr('Kunlik')}</button>
              <button type="button" className={group === 'month' ? 'active' : ''} onClick={() => setGroup('month')}>{tr('Oylik')}</button>
            </div>
          </label>
        </div>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{group === 'month' ? tr('Oy') : tr('Sana')}</th><th className="num">{tr('Kirim')}</th><th className="num">{tr('Chiqim')}</th><th className="num">{tr('Sof oqim')}</th><th className="num">{tr('Qoldiq')}</th></tr></thead>
            <tbody>
              <tr className="muted"><td>{tr('Davr boshidagi qoldiq')} ({date(data.date_from)})</td><td /><td /><td /><td className="num bold"><MoneyBag bag={data.opening} /></td></tr>
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <td>{label(r)}</td>
                  <td className="num green"><MoneyBag bag={r.in} /></td>
                  <td className="num red"><MoneyBag bag={r.out} /></td>
                  <td className="num bold"><MoneyBag bag={r.net} /></td>
                  <td className="num"><MoneyBag bag={r.balance} /></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={5} className="empty">{tr("Davrda pul harakati yo'q")}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td>{tr('Jami davr uchun')}</td><td className="num green"><MoneyBag bag={data.totals.in} /></td><td className="num red"><MoneyBag bag={data.totals.out} /></td>
                <td className="num"><MoneyBag bag={data.totals.net} /></td><td className="num"><MoneyBag bag={data.closing} /></td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}

export default function FinancePage() {
  const [tab, setTab] = useState('tx')
  const [form, setForm] = useState(null)
  const tabs = [['tx', tr("To'lovlar")], ['settle', tr("O'zaro hisob-kitoblar")], ['adj', tr('Korrektirovkalar')], ['pnl', tr("Foyda va zarar")], ['cf', tr("Pul oqimi")]]
  return (
    <>
      <div className="page-head">
        <h1>{tr("Pul")}</h1>
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'tx' && <Payments />}
      {tab === 'settle' && <Settlements />}
      {tab === 'adj' && <Adjustments />}
      {tab === 'pnl' && <Pnl />}
      {tab === 'cf' && <CashFlow />}
      {form && <TransactionForm kind={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); toast('Saqlandi') }} />}
    </>
  )
}

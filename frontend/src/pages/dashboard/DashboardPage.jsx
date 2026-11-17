import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, MoneyBag, Stat, useFetch } from '../../components/ui'
import { MONTHS, money, monthStartISO, pct, todayISO } from '../../format'
import { ProductionDashboard } from '../production/Board'
import { t } from '../../i18n'

const PERIODS = {
  month: () => ({ date_from: monthStartISO(), date_to: todayISO() }),
  quarter: () => {
    const d = new Date()
    return { date_from: monthStartISO(new Date(d.getFullYear(), d.getMonth() - 2, 1)), date_to: todayISO() }
  },
  year: () => ({ date_from: `${new Date().getFullYear()}-01-01`, date_to: todayISO() }),
}

function Chart({ months, currency }) {
  const vals = months.flatMap((m) => [Number(m.revenue[currency]), Math.abs(Number(m.profit[currency]))])
  const max = Math.max(1, ...vals)
  const h = (v) => `${Math.max(1, (Math.abs(v) / max) * 100)}%`
  return (
    <>
      <div className="bars">
        {months.map((m) => {
          const p = Number(m.profit[currency])
          return (
            <div className="grp" key={m.month} title={`Tushum: ${money(m.revenue[currency], currency)}\nFoyda: ${money(p, currency)}`}>
              <div className="bar rev" style={{ height: h(m.revenue[currency]) }} />
              <div className={'bar ' + (p < 0 ? 'neg' : 'pro')} style={{ height: h(p) }} />
            </div>
          )
        })}
      </div>
      <div className="bar-labels">{months.map((m) => <div key={m.month}>{t(MONTHS[Number(m.month.slice(5)) - 1])}</div>)}</div>
    </>
  )
}

function Director() {
  const [period, setPeriod] = useState('year')
  const [cur, setCur] = useState('UZS')
  const { data, error } = useFetch('/dashboard/director/', PERIODS[period]())
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="page-head">
        <h1>{t("Direktor dashboardi")}</h1>
        <span className="grow" />
        <div className="segmented">
          {[['month', t("Oy")], ['quarter', t("Chorak")], ['year', t("Yil")]].map(([k, l]) => (
            <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stats">
        <Stat label={t("Tushum")} bag={data.revenue} />
        <Stat label={t("Tannarx")} bag={data.cost} />
        <Stat label={t("Foyda")} bag={data.profit} />
        <Stat label={t("Rentabellik (foyda / tushum)")} value={pct(data.margin_pct.UZS)} sub={t("so'mdagi buyurtmalar · USD buyurtmalar: {n}", { n: pct(data.margin_pct.USD) })} />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2 style={{ margin: 0 }}>{t('Oylik tushum va foyda')} ({cur === 'USD' ? 'USD' : t("so'm")})</h2>
            <div className="segmented">
              <button className={cur === 'UZS' ? 'active' : ''} onClick={() => setCur('UZS')}>{t("so'm")}</button>
              <button className={cur === 'USD' ? 'active' : ''} onClick={() => setCur('USD')}>USD</button>
            </div>
          </div>
          <Chart months={data.monthly} currency={cur} />
          <div className="hint">{t("Ko'k — tushum, yashil — foyda (qizil — zarar). Har bir buyurtma foydasi o'z valyutasida hisoblanadi.")}</div>
        </div>
        <div>
          <div className="card">
            <h2>{t("Eng zararli buyurtmalar")}</h2>
            <ul className="list-plain">
              {data.worst_orders.map((o) => (
                <li key={o.id}><Link to={`/orders/${o.id}`}>{o.number}</Link> · {o.client} · <span className="red">{money(o.profit, o.currency)}</span></li>
              ))}
              {!data.worst_orders.length && <li className="muted">{t("Zararli buyurtma yo'q")}</li>}
            </ul>
          </div>
          <div className="card">
            <h2>{t("Qarzlar")}</h2>
            <div className="small">{t("Mijozlar:")} <MoneyBag bag={data.debts.clients} inline /></div>
            <div className="small" style={{ marginTop: 4 }}>{t("Yetkazuvchilarga:")} <MoneyBag bag={data.debts.suppliers} inline /></div>
          </div>
          <div className="card">
            <h2>{t("Statuslar")}</h2>
            <ul className="list-plain">
              {data.statuses.filter((s) => s.count && s.status !== 'cancelled').map((s) => <li key={s.status}>{t(s.label)}: <b>{s.count}</b></li>)}
              {data.overdue_orders > 0 && <li className="red">{t("Kechikkan:")} <b>{data.overdue_orders}</b></li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

export default function DashboardPage() {
  const [tab, setTab] = useState('director')
  return (
    <>
      <div className="tabs">
        <button className={'btn' + (tab === 'director' ? ' active' : '')} onClick={() => setTab('director')}>{t("Direktor")}</button>
        <button className={'btn' + (tab === 'production' ? ' active' : '')} onClick={() => setTab('production')}>{t("Ishlab chiqarish")}</button>
      </div>
      {tab === 'director' ? <Director /> : <ProductionDashboard />}
    </>
  )
}

import { useState } from 'react'
import api, { errorText } from '../../api'
import { Loading, Stat, toast, useFetch } from '../../components/ui'
import { MONTHS, money, monthStartISO, num, qty } from '../../format'
import { t as tr } from '../../i18n'

function MonthPicker({ value, onChange }) {
  const opts = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    opts.push(monthStartISO(m))
  }
  return (
    <select className="btn" value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => <option key={o} value={o}>{MONTHS[Number(o.slice(5, 7)) - 1]} {o.slice(0, 4)}</option>)}
    </select>
  )
}

function KpiResults({ month }) {
  const { data, error } = useFetch('/hr/kpi-results/', { month })
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{tr("Xodim / bo'lim")}</th><th>{tr("Ko'rsatkich")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Fakt")}</th><th className="num">{tr("Bajarilish")}</th><th className="num">{tr("Bonus koeff.")}</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td>{r.subject}</td>
              <td>{r.template_name}</td>
              <td className="num">{qty(r.plan)} {r.unit}</td>
              <td className="num">{qty(r.fact)} {r.unit}</td>
              <td className={'num ' + (Number(r.achievement_pct) < 90 ? 'red' : Number(r.achievement_pct) >= 110 ? 'green' : '')}>{num(r.achievement_pct, 1)}%</td>
              <td className="num bold">×{num(r.coefficient, 1)}</td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={6} className="empty">{tr("Bu oy uchun KPI kiritilmagan")}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function KpiTemplates() {
  const { data, error } = useFetch('/hr/kpi-templates/')
  const scale = useFetch('/hr/kpi-scale/')
  if (!data) return <Loading error={error} />
  const global = (scale.data || []).filter((s) => !s.template)
  return (
    <div className="grid-2">
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Shablon")}</th><th>{tr("Birlik")}</th><th>{tr("Yo'nalish")}</th><th>{tr("Formula")}</th><th className="num">{tr("Yuqori chegara")}</th></tr></thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td><td>{tr(t.unit)}</td><td>{tr(t.direction_display)}</td>
                <td className="small muted">{t.direction === 'higher' ? 'fakt / reja' : 'reja / fakt'}</td>
                <td className="num">{num(t.cap_pct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>{tr("Koeffitsiyentlar shkalasi")}</h2>
        <ul className="list-plain">
          {global.map((s) => <li key={s.id}>Bajarilish ≥ {num(s.min_pct)}% → <b>×{num(s.coefficient, 1)}</b></li>)}
        </ul>
        <div className="hint">{tr("KPI bonus = xodimning bonus bazasi × koeffitsiyent. Xodimning shaxsiy KPI'si bo'lmasa — bo'lim KPI'lari o'rtachasi.")}</div>
      </div>
    </div>
  )
}

function Payroll({ month }) {
  const { data, error } = useFetch('/hr/payroll/', { month })
  if (!data) return <Loading error={error} />
  const t = data.totals
  return (
    <>
      <div className="stats">
        <Stat label={tr("Jami hisoblangan")} value={money(t.accrued, 'UZS')} sub={`${data.employees} xodim`} />
        <Stat label={tr("KPI bonus")} value={money(t.bonus, 'UZS')} />
        <Stat label={tr("Avans va ushlanma")} value={money(Number(t.advance) + Number(t.deduction), 'UZS')} />
        <Stat label={tr("To'lanadi")} value={money(t.net, 'UZS')} />
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Xodim")}</th><th>{tr("Tizim")}</th><th className="num">{tr("Kun")}</th><th className="num">{tr("Hisoblangan")}</th><th className="num">{tr("KPI koeff.")}</th><th className="num">{tr("KPI bonus")}</th><th className="num">{tr("Avans")}</th><th className="num">{tr("Ushlanma")}</th><th className="num">{tr("To'lanadi")}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.employee}>
                <td>{r.name}{r.department && ` · ${r.department}`}</td>
                <td>{tr(r.pay_system_display)}</td>
                <td className="num">{r.days}</td>
                <td className="num">{num(r.accrued)}</td>
                <td className="num muted">{r.kpi_coefficient ? '×' + num(r.kpi_coefficient, 2) : '—'}</td>
                <td className="num green">+ {num(r.bonus)}</td>
                <td className="num">{Number(r.advance) ? '− ' + num(r.advance) : '—'}</td>
                <td className="num">{Number(r.deduction) ? '− ' + num(r.deduction) : '—'}</td>
                <td className="num bold">{num(r.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{tr("Jami")}</td>
              <td className="num">{num(t.accrued)}</td><td />
              <td className="num">{num(t.bonus)}</td>
              <td className="num">{num(t.advance)}</td>
              <td className="num">{num(t.deduction)}</td>
              <td className="num">{num(t.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="hint">{tr("Ish haqi so'mda yuritiladi; ishbay summa buyurtma tannarxining D blokiga tushadi. Kartochkalar va jadval jami bitta hisobdan olinadi.")}</div>
    </>
  )
}

function Timesheets({ month }) {
  const [stamp, setStamp] = useState(0)
  const emps = useFetch('/hr/employees/', { is_active: true })
  const ts = useFetch('/hr/timesheets/', { month, stamp })
  if (!emps.data || !ts.data) return <Loading error={emps.error || ts.error} />
  const byEmp = Object.fromEntries(ts.data.map((t) => [t.employee, t]))
  const save = async (emp, days) => {
    try {
      const existing = byEmp[emp.id]
      if (existing) await api.patch(`/hr/timesheets/${existing.id}/`, { days_worked: days })
      else await api.post('/hr/timesheets/', { employee: emp.id, month, days_worked: days })
      setStamp((s) => s + 1)
      toast('Tabel saqlandi')
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className="table-wrap" style={{ maxWidth: 700 }}>
      <table className="t">
        <thead><tr><th>{tr("Xodim")}</th><th>{tr("Tizim")}</th><th className="num">{tr("Ishlagan kun")}</th><th className="num">{tr("Norma")}</th></tr></thead>
        <tbody>
          {emps.data.map((e) => (
            <tr key={e.id}>
              <td>{e.full_name}</td>
              <td>{tr(e.pay_system_display)}</td>
              <td className="num">
                <input className="cell" defaultValue={byEmp[e.id]?.days_worked ?? ''} key={`${e.id}-${stamp}`}
                  onBlur={(ev) => ev.target.value !== String(byEmp[e.id]?.days_worked ?? '') && save(e, ev.target.value)} />
              </td>
              <td className="num muted">{byEmp[e.id]?.working_days ?? 22}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HrPage() {
  const [tab, setTab] = useState('kpi')
  const [month, setMonth] = useState(monthStartISO())
  const tabs = [['kpi', tr("KPI natijalar")], ['templates', tr("Shablonlar va koeffitsiyentlar")], ['payroll', tr("Oylik vedomost")], ['tabel', tr("Davomat (tabel)")]]
  return (
    <>
      <div className="page-head">
        <h1>{tab === 'payroll' || tab === 'tabel' ? 'Oylik (maosh)' : 'KPI'}</h1>
        <span className="grow" />
        <MonthPicker value={month} onChange={setMonth} />
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'kpi' && <KpiResults month={month} />}
      {tab === 'templates' && <KpiTemplates />}
      {tab === 'payroll' && <Payroll month={month} />}
      {tab === 'tabel' && <Timesheets month={month} />}
    </>
  )
}

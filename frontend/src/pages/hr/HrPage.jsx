import { useState } from 'react'
import api, { errorText } from '../../api'
import { Loading, Stat, toast, useFetch } from '../../components/ui'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import EntityForm from '../../components/EntityForm'
import { IconBtn } from '../../components/Icon'
import { confirmDialog } from '../../components/Confirm'
import { NumInput } from '../../components/Inputs'
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
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [form, setForm] = useState(null)
  const { data, error } = useFetch('/hr/kpi-results/', { month, stamp })
  const tpls = useFetch('/hr/kpi-templates/')
  const emps = useFetch('/hr/employees/', { is_active: true })
  const deps = useFetch('/production/departments/')
  const remove = async (r) => {
    if (!(await confirmDialog(tr("O'chirilsinmi?") + `\n${r.subject} · ${r.template_name}`))) return
    try { await api.delete(`/hr/kpi-results/${r.id}/`); setStamp((x) => x + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  const list = data.results || data
  return (
    <>
      <div className="table-wrap">
        {canCreate(user, 'hr') && (
          <div className="table-toolbar">
            <button className="btn primary small" onClick={() => setForm({ item: null })}>{tr('+ KPI natija')}</button>
            <span className="muted small">{tr('Oy')}: {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span>
          </div>
        )}
        <table className="t">
          <thead><tr><th>{tr("Xodim / bo'lim")}</th><th>{tr("Ko'rsatkich")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Fakt")}</th><th className="num">{tr("Bajarilish")}</th><th className="num">{tr("Bonus koeff.")}</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={canEdit(user, 'hr') ? 'clickable' : ''} onClick={() => canEdit(user, 'hr') && setForm({ item: r })}>
                <td>{r.subject}</td>
                <td>{r.template_name}</td>
                <td className="num">{qty(r.plan)} {r.unit}</td>
                <td className="num">{qty(r.fact)} {r.unit}</td>
                <td className={'num ' + (Number(r.achievement_pct) < 90 ? 'red' : Number(r.achievement_pct) >= 110 ? 'green' : '')}>{num(r.achievement_pct, 1)}%</td>
                <td className="num bold">×{num(r.coefficient, 1)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'hr') && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(r)} />}</td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={7} className="empty">
                {tr("Bu oy uchun KPI kiritilmagan")}
                {canCreate(user, 'hr') && <> · <button className="link-btn" onClick={() => setForm({ item: null })}>{tr("KPI natija qo'shish")}</button></>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{tr("Natija: xodim (yoki bo'lim) bo'yicha oy rejasi va fakti. Bajarilish va koeffitsiyent shablon va shkala bo'yicha avtomatik hisoblanadi; oylik vedomostda KPI bonusiga qo'shiladi.")}</span></div>
      {form && (
        <EntityForm title={form.item ? tr('KPI natija') : tr('Yangi KPI natija')} url="/hr/kpi-results/" item={form.item}
          fields={[
            { name: 'template', label: tr("Ko'rsatkich (shablon)"), type: 'select', required: true, options: (tpls.data || []).map((x) => [x.id, `${x.name}${x.unit ? ` (${x.unit})` : ''}`]) },
            { name: 'employee', label: tr('Xodim'), type: 'select', options: (emps.data?.results || emps.data || []).map((x) => [x.id, x.full_name]) },
            { name: 'department', label: tr("yoki bo'lim"), type: 'select', options: (deps.data || []).map((x) => [x.id, x.name]) },
            { name: 'plan', label: tr('Reja'), type: 'number', required: true },
            { name: 'fact', label: tr('Fakt'), type: 'number', required: true },
            { name: 'month', label: tr('Oy (1-kun)'), type: 'date', required: true },
          ]}
          defaults={{ month, plan: '', fact: '' }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((x) => x + 1); toast(tr('Saqlandi')) }} />
      )}
    </>
  )
}

function KpiTemplates() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [form, setForm] = useState(null)
  const [row, setRow] = useState({ min_pct: '', coefficient: '' })
  const { data, error } = useFetch('/hr/kpi-templates/', { stamp })
  const scale = useFetch('/hr/kpi-scale/', { stamp })
  const editable = canEdit(user, 'hr')
  if (!data) return <Loading error={error} />
  const global = (scale.data || []).filter((x) => !x.template).sort((a, b) => Number(b.min_pct) - Number(a.min_pct))
  const reload = () => setStamp((x) => x + 1)
  const removeTpl = async (x) => {
    if (!(await confirmDialog(tr("O'chirilsinmi?") + `\n${x.name}`))) return
    try { await api.delete(`/hr/kpi-templates/${x.id}/`); reload() } catch (e) { toast(errorText(e), true) }
  }
  const addScale = async () => {
    if (row.min_pct === '' || row.coefficient === '') return
    try { await api.post('/hr/kpi-scale/', row); setRow({ min_pct: '', coefficient: '' }); reload() } catch (e) { toast(errorText(e), true) }
  }
  const removeScale = async (x) => {
    try { await api.delete(`/hr/kpi-scale/${x.id}/`); reload() } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className="grid-2">
      <div className="table-wrap">
        {canCreate(user, 'hr') && <div className="table-toolbar"><button className="btn primary small" onClick={() => setForm({ item: null })}>{tr('+ Shablon')}</button></div>}
        <table className="t">
          <thead><tr><th>{tr("Shablon")}</th><th>{tr("Birlik")}</th><th>{tr("Yo'nalish")}</th><th>{tr("Formula")}</th><th className="num">{tr("Yuqori chegara")}</th><th /></tr></thead>
          <tbody>
            {data.map((x) => (
              <tr key={x.id} className={editable ? 'clickable' : ''} onClick={() => editable && setForm({ item: x })}>
                <td>{x.name}</td><td>{tr(x.unit)}</td><td>{tr(x.direction_display)}</td>
                <td className="small muted">{x.direction === 'higher' ? tr('fakt / reja') : tr('reja / fakt')}</td>
                <td className="num">{num(x.cap_pct)}%</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'hr') && <IconBtn icon="delete" danger title="O'chirish" onClick={() => removeTpl(x)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>{tr("Koeffitsiyentlar shkalasi")}</h2>
        <table className="t">
          <tbody>
            {global.map((x) => (
              <tr key={x.id}>
                <td>{tr('Bajarilish')} ≥ {num(x.min_pct)}%</td>
                <td className="num bold">×{num(x.coefficient, 1)}</td>
                <td className="num">{editable && <IconBtn icon="delete" danger title="O'chirish" onClick={() => removeScale(x)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div className="kpi-scale-add">
            <span>≥</span><NumInput value={row.min_pct} placeholder="%" onChange={(e) => setRow({ ...row, min_pct: e.target.value })} />
            <span>% → ×</span><NumInput value={row.coefficient} placeholder="1.0" onChange={(e) => setRow({ ...row, coefficient: e.target.value })} />
            <button className="btn small" onClick={addScale}>{tr("Qo'shish")}</button>
          </div>
        )}
        <div className="hint">{tr("KPI bonus = xodimning bonus bazasi × koeffitsiyent. Xodimning shaxsiy KPI'si bo'lmasa — bo'lim KPI'lari o'rtachasi.")}</div>
      </div>
      {form && (
        <EntityForm title={form.item ? form.item.name : tr('Yangi KPI shablon')} url="/hr/kpi-templates/" item={form.item}
          fields={[
            { name: 'name', label: tr('Nomi'), required: true },
            { name: 'unit', label: tr('Birlik (mln, %, dona…)') },
            { name: 'direction', label: tr("Yo'nalish"), type: 'select', noEmpty: true, options: [['higher', tr("Ko'p — yaxshi (fakt / reja)")], ['lower', tr('Kam — yaxshi (reja / fakt)')]] },
            { name: 'cap_pct', label: tr('Yuqori chegara, %'), type: 'number' },
          ]}
          defaults={{ direction: 'higher', cap_pct: 150 }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); toast(tr('Saqlandi')) }} />
      )}
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

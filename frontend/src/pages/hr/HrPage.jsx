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

const SOURCES = [
  ['manual', "Qo'lda kiritiladi"], ['sales_amount', 'Sotuvlar summasi (sotuvchi)'], ['orders_amount', 'Buyurtmalar summasi (menejer)'],
  ['piece_amount', 'Ishbay haq summasi'], ['done_qty', 'Bajarilgan ish hajmi (bosqichlar)'], ['on_time_pct', 'Muddatida topshirish, %'],
  ['defect_pct', 'Brak ulushi, %'],
]

function KpiResults({ month, give = false }) {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [form, setForm] = useState(null)
  const [f, setF] = useState({ employee: '', department: '', template: '' })
  const params = Object.fromEntries(Object.entries({ month, stamp, ...f }).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/hr/kpi-results/', params)
  const tpls = useFetch('/hr/kpi-templates/')
  const emps = useFetch('/hr/employees/', { is_active: true })
  const deps = useFetch('/production/departments/')
  const remove = async (r) => {
    if (!(await confirmDialog(tr("O'chirilsinmi?") + `\n${r.subject} · ${r.template_name}`))) return
    try { await api.delete(`/hr/kpi-results/${r.id}/`); setStamp((x) => x + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  const list = data.results || data
  const empList = emps.data?.results || emps.data || []
  return (
    <>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          {give && canCreate(user, 'hr') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{tr('+ KPI berish')}</button>}
          <select value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">{tr('Xodim: hammasi')}</option>
            {empList.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select>
          <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">{tr("Bo'lim: hammasi")}</option>
            {(deps.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
            <option value="">{tr("Ko'rsatkich: hammasi")}</option>
            {(tpls.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span className="muted small">{tr('Oy')}: {tr(MONTHS[Number(month.slice(5, 7)) - 1])} {month.slice(0, 4)}</span>
        </div>
        <table className="t">
          <thead><tr><th>{tr("Xodim / bo'lim")}</th><th>{tr("Ko'rsatkich")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Fakt")}</th><th className="num">{tr("Bajarilish")}</th><th className="num">{tr("Bonus koeff.")}</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={canEdit(user, 'hr') ? 'clickable' : ''} onClick={() => canEdit(user, 'hr') && setForm({ item: r })}>
                <td>{r.subject}</td>
                <td>{r.template_name}</td>
                <td className="num">{qty(r.plan)} {r.unit}</td>
                <td className="num">{qty(r.fact)} {r.unit}{r.source !== 'manual' && <span className="kpi-auto" title={tr('Avtomatik hisoblanadi')}>{tr('avto')}</span>}</td>
                <td className={'num ' + (Number(r.achievement_pct) < 90 ? 'red' : Number(r.achievement_pct) >= 110 ? 'green' : '')}>{num(r.achievement_pct, 1)}%</td>
                <td className="num bold">×{num(r.coefficient, 1)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'hr') && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(r)} />}</td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={7} className="empty">
                {tr("Bu oy uchun KPI kiritilmagan")}
                {canCreate(user, 'hr') && give && <> · <button className="link-btn" onClick={() => setForm({ item: null })}>{tr('KPI berish')}</button></>}
                {!give && <> · {tr("«KPI berish» bo'limida reja bering")}</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{tr("Fakt «avto» belgili ko'rsatkichlarda sotuv, ishbay haq, bajarilgan ish va brakdan o'zi hisoblanadi; qolganlarida qo'lda kiritiladi. Bajarilish va koeffitsiyent shkala bo'yicha; oylik vedomostda KPI bonusiga qo'shiladi.")}</span></div>
      {form && (
        <EntityForm title={form.item ? tr('KPI') : tr('KPI berish')} url="/hr/kpi-results/" item={form.item}
          fields={[
            { name: 'template', label: tr("Ko'rsatkich (shablon)"), type: 'select', required: true, options: (tpls.data || []).map((x) => [x.id, `${x.name}${x.unit ? ` (${x.unit})` : ''}${x.source !== 'manual' ? ' · ' + tr('avto') : ''}`]) },
            { name: 'employee', label: tr('Xodim'), type: 'select', options: empList.map((x) => [x.id, x.full_name]) },
            { name: 'department', label: tr("yoki bo'lim"), type: 'select', options: (deps.data || []).map((x) => [x.id, x.name]) },
            { name: 'plan', label: tr('Reja'), type: 'number', required: true },
            { name: 'fact', label: tr("Fakt (avto ko'rsatkichda o'zi hisoblanadi)"), type: 'number' },
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
        <div className="table-toolbar"><b>{tr("Ko'rsatkichlar (shablonlar)")}</b><span className="grow" />{canCreate(user, 'hr') && <button className="btn small" onClick={() => setForm({ item: null })}>{tr('+ Shablon')}</button>}</div>
        <table className="t">
          <thead><tr><th>{tr("Ko'rsatkich")}</th><th>{tr("Birlik")}</th><th>{tr("Fakt manbai")}</th><th>{tr("Formula")}</th><th className="num">{tr("Yuqori chegara")}</th><th /></tr></thead>
          <tbody>
            {data.map((x) => (
              <tr key={x.id} className={editable ? 'clickable' : ''} onClick={() => editable && setForm({ item: x })}>
                <td>{x.name}</td><td>{tr(x.unit)}</td><td className="small">{tr(x.source_display)}</td>
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
            { name: 'source', label: tr('Fakt manbai'), type: 'select', noEmpty: true, options: SOURCES.map(([k, l]) => [k, tr(l)]) },
            { name: 'cap_pct', label: tr('Yuqori chegara, %'), type: 'number' },
          ]}
          defaults={{ direction: 'higher', cap_pct: 150, source: 'manual' }}
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
        <Stat label={tr("Avans, ushlanma va to'langan")} value={money(Number(t.advance) + Number(t.deduction) + Number(t.paid || 0), 'UZS')} />
        <Stat label={tr("To'lanadi")} value={money(t.net, 'UZS')} />
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Xodim")}</th><th>{tr("Tizim")}</th><th className="num">{tr("Kun")}</th><th className="num">{tr("Hisoblangan")}</th><th>{tr('KPI (reja → fakt)')}</th><th className="num">{tr("KPI koeff.")}</th><th className="num">{tr("KPI bonus")}</th><th className="num">{tr("Avans")}</th><th className="num">{tr("Ushlanma")}</th><th className="num">{tr("Kassadan to'langan")}</th><th className="num">{tr("To'lanadi")}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.employee}>
                <td>{r.name}{r.department && ` · ${r.department}`}</td>
                <td>{tr(r.pay_system_display)}</td>
                <td className="num">{r.days}</td>
                <td className="num">{num(r.accrued)}</td>
                <td className="small">{r.kpi?.length ? r.kpi.map((k) => <div key={k.name}>{k.name}: {qty(k.plan)} → {qty(k.fact)} <b className={Number(k.pct) < 90 ? 'red' : 'green'}>{num(k.pct, 0)}%</b></div>) : <span className="muted">—</span>}</td>
                <td className="num muted">{r.kpi_coefficient ? '×' + num(r.kpi_coefficient, 2) : '—'}</td>
                <td className="num green">+ {num(r.bonus)}</td>
                <td className="num">{Number(r.advance) ? '− ' + num(r.advance) : '—'}</td>
                <td className="num">{Number(r.deduction) ? '− ' + num(r.deduction) : '—'}</td>
                <td className="num">{Number(r.paid) ? '− ' + num(r.paid) : '—'}</td>
                <td className="num bold">{num(r.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{tr("Jami")}</td>
              <td className="num">{num(t.accrued)}</td><td /><td />
              <td className="num">{num(t.bonus)}</td>
              <td className="num">{num(t.advance)}</td>
              <td className="num">{num(t.deduction)}</td>
              <td className="num">{num(t.paid)}</td>
              <td className="num">{num(t.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="hint">{tr("Ish haqi so'mda yuritiladi. «Kassadan to'langan» — Pul bo'limida chiqim orderi orqali xodimga berilgan ish haqi (kontragent tanlashda «Xodimlar» guruhi).")}</div>
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
  const tabs = [['kpi', tr("KPI natijalar")], ['give', tr("KPI berish")], ['payroll', tr("Oylik vedomost")], ['tabel', tr("Davomat (tabel)")]]
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
      {tab === 'give' && <><KpiResults month={month} give /><div style={{ height: 16 }} /><KpiTemplates /></>}
      {tab === 'payroll' && <Payroll month={month} />}
      {tab === 'tabel' && <Timesheets month={month} />}
    </>
  )
}

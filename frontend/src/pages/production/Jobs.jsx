import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canEdit, useAuth } from '../../auth'
import { Drawer } from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, Progress, Stat, toast, useFetch } from '../../components/ui'
import { date, monthStartISO, money, num, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import Icon, { IconBtn } from '../../components/Icon'
import { SearchSelect } from '../../components/Controls'
import { confirmDialog } from '../../components/Confirm'
import ExtraMaterials, { extraPayload } from './ExtraMaterials'
import { DateInput, NumInput } from '../../components/Inputs'

const JOB_STATUSES = [['new', tr("Yangi")], ['in_progress', tr("Jarayonda")], ['done', tr("Bajarildi")], ['cancelled', tr("Bekor qilindi")]]
const JOB_BADGE = { new: 'new', in_progress: 'in_production', done: 'done', cancelled: 'cancelled' }

/* ------------------------------------------------------------ bosqichni bajarish */
export function CompleteStageModal({ task, onClose, onSaved }) {
  const emps = useFetch('/hr/employees/', { is_active: true })
  const [v, setV] = useState({ qty: String(Number(task.remaining ?? (task.plan_qty - task.done_qty))), defect_qty: '0', employee: task.operation_employee ? String(task.operation_employee) : '', date: todayISO(), note: '' })
  const [extra, setExtra] = useState([])
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/production/tasks/${task.id}/complete/`, { ...v, employee: v.employee || undefined, extra_materials: extraPayload(extra) })
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={`Bosqichni bajarish: ${task.operation_name || task.operation}`} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <p className="muted" style={{ marginTop: 0 }}>Reja: {qty(task.plan_qty)} · Bajarilgan: {qty(task.done_qty)} · Qolgan: <b>{qty(task.remaining ?? task.plan_qty - task.done_qty)}</b> {task.unit}</p>
      <form className="form" onSubmit={submit}>
        <Field label={`Bajarildi, ${task.unit || ''}`}><NumInput step="any" min="0" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} required autoFocus /></Field>
        <Field label={tr("Brak")}><NumInput step="any" min="0" value={v.defect_qty} onChange={(e) => setV({ ...v, defect_qty: e.target.value })} /></Field>
        <Field label={tr("Ijrochi (ishbay haq hisoblanadi)")}>
          <select value={v.employee} disabled={!!task.operation_employee} title={task.operation_employee ? tr('Bosqichga biriktirilgan xodim') : ''} onChange={(e) => setV({ ...v, employee: e.target.value })}>
            <option value="">{tr("— men —")}</option>
            {(emps.data || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.department_name ? ` · ${x.department_name}` : ''}</option>)}
          </select>
        </Field>
        <Field label={tr("Sana")}><DateInput value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label={tr("Izoh")} full><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        <div className="full"><ExtraMaterials value={extra} onChange={setExtra} /></div>
        <p className="hint full" style={{ margin: 0 }}>{tr("Bajarilganda: shu bosqich materiallari ombordan chiqim qilinadi; oxirgi bosqichda tayyor mahsulot omborga kirim qilinadi.")}</p>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{tr("Bekor")}</button>
          <button className="btn primary">{tr("Bajarildi")}</button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------ topshiriq yaratish */
function JobForm({ onClose, onSaved, preset }) {
  const tcs = useFetch('/production/techcards/', { is_active: true })
  const whs = useFetch('/warehouse/warehouses/')
  const [v, setV] = useState({ techcard: preset?.techcard || '', qty: preset?.qty || '1', materials_warehouse: '', products_warehouse: '',
    plan_start: todayISO(), plan_end: '', note: '' })
  const [error, setError] = useState(null)
  const tc = (tcs.data || []).find((x) => String(x.id) === String(v.techcard))
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post('/production/jobs/', v)
      onSaved(data)
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={tr("Yangi ishlab chiqarish topshirig'i")} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label={tr("Texkarta")} full>
          <SearchSelect value={v.techcard} onChange={(id) => setV({ ...v, techcard: id })} placeholder={tr("— tanlang —")}
            options={(tcs.data || []).map((x) => ({ value: x.id, label: x.product_name, sub: x.name }))} />
        </Field>
        <Field label={`Miqdor${tc ? `, ${tc.product_unit}` : ''}`}><NumInput step="any" min="0" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} required /></Field>
        <div />
        <Field label={tr("Materiallar ombori (bo'sh — qoldiq bor ombordan)")}>
          <select value={v.materials_warehouse} onChange={(e) => setV({ ...v, materials_warehouse: e.target.value })}>
            <option value="">{tr("— avtomatik —")}</option>
            {(whs.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={tr("Mahsulot ombori")}>
          <select value={v.products_warehouse} onChange={(e) => setV({ ...v, products_warehouse: e.target.value })} required>
            <option value="">{tr("— tanlang —")}</option>
            {(whs.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={tr("Boshlash (reja)")}><DateInput value={v.plan_start} onChange={(e) => setV({ ...v, plan_start: e.target.value })} /></Field>
        <Field label={tr("Tugatish (reja)")}><DateInput value={v.plan_end} onChange={(e) => setV({ ...v, plan_end: e.target.value })} /></Field>
        <Field label={tr("Izoh")} full><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        {tc?.cost && <p className="hint full" style={{ margin: 0 }}>Rejaviy tannarx: {money(tc.cost.total, tc.cost.currency)} / {tc.product_unit} (material {money(tc.cost.materials, tc.cost.currency)} + ish haqi {money(tc.cost.labor, tc.cost.currency)})</p>}
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{tr("Bekor")}</button>
          <button className="btn primary">{tr("Yaratish")}</button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------ topshiriq kartasi */
export function JobCard({ id, onClose, onChanged }) {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data: j, error } = useFetch(`/production/jobs/${id}/`, { stamp })
  const tasks = useFetch('/production/tasks/', { job: id, stamp })
  const mats = useFetch(`/production/jobs/${id}/materials/`, { stamp })
  const [complete, setComplete] = useState(null)
  if (!j) return <Drawer onClose={onClose}><Loading error={error} /></Drawer>
  const refresh = () => { setStamp((s) => s + 1); onChanged?.() }
  const cancel = async () => {
    if (!await confirmDialog('Topshiriq bekor qilinsinmi?')) return
    try { await api.post(`/production/jobs/${id}/cancel/`); toast('Bekor qilindi'); refresh() } catch (e) { toast(errorText(e), true) }
  }
  const editable = canEdit(user, 'production')
  return (
    <Drawer onClose={onClose}>
      <div className="page-head">
        <div>
          <h1>Topshiriq №{j.number}</h1>
          <div className="page-sub">{j.title}{j.techcard_name ? ` · texkarta: ${j.techcard_name}` : ''}</div>
        </div>
        <Badge kind={JOB_BADGE[j.status]}>{j.status_display}</Badge>
        <span className="grow" />
        {editable && ['new'].includes(j.status) && <button className="btn" onClick={cancel}>{tr("Bekor qilish")}</button>}
        <button className="btn" onClick={onClose}><Icon name="back" size={16} /> {tr("Orqaga")}</button>
      </div>
      <div className="stats">
        <Stat label={tr("Reja")} value={`${qty(j.qty)} ${j.product_unit}`} sub={j.plan_end ? `Muddat: ${date(j.plan_end)}` : null} />
        {j.techcard && <Stat label={tr("Ishlab chiqarildi")} value={`${qty(j.produced_qty)} ${j.product_unit}`} valueClass="green" sub={j.products_warehouse_name ? `→ ${j.products_warehouse_name}` : null} />}
        {j.techcard && Number(j.produced_qty) > 0 && <Stat label={tr("Haqiqiy tannarx")} value={num(Number(j.capitalized) / Number(j.produced_qty), 2)} sub={tr('jami {n}', { n: num(j.capitalized) })} />}
        <Stat label={tr("Bajarilish")} value={`${Math.round(j.progress * 100)}%`} />
      </div>
      {j.order && <div className="card" style={{ marginBottom: 12 }}>{tr("Mijoz buyurtmasi:")} <Link to={`/orders/${j.order}`}>№{j.order_number}</Link></div>}
      <h2>{tr("Bosqichlar")}</h2>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>#</th><th>{tr("Bosqich")}</th><th>{tr("Bo'lim")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Bajarildi")}</th><th className="num">{tr("Brak")}</th><th style={{ width: 160 }}>{tr("Holat")}</th><th /></tr></thead>
          <tbody>
            {(tasks.data || []).sort((a, b) => a.position - b.position).map((t, i) => (
              <tr key={t.id}>
                <td className="muted">{i + 1}</td>
                <td className="bold">{t.operation_name}</td>
                <td>{t.department_name}</td>
                <td className="num">{qty(t.plan_qty)} {t.unit}</td>
                <td className="num">{qty(t.done_qty)}</td>
                <td className="num">{Number(t.defect_qty) ? qty(t.defect_qty) : '—'}</td>
                <td><Badge kind={t.status}>{t.status_display}</Badge><Progress value={t.progress} /></td>
                <td className="num">{editable && t.status !== 'done' && j.status !== 'cancelled' && <button className="btn small primary" onClick={() => setComplete(t)}>{tr("Bajarish")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 style={{ marginTop: 18 }}>{tr("Materiallar")}</h2>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Material")}</th><th className="num">{tr("Me'yor")}</th><th className="num">{tr("Sarflandi")}</th><th className="num">{tr("Qoldi")}</th><th className="num">{tr("Omborda")}</th><th className="num">{tr("Yetishmaydi")}</th></tr></thead>
          <tbody>
            {(mats.data || []).map((m) => (
              <tr key={m.material_id}>
                <td>{m.material}</td>
                <td className="num">{qty(m.need)} {m.unit}</td>
                <td className="num">{qty(m.spent)}</td>
                <td className="num">{qty(m.remaining)}</td>
                <td className="num">{qty(m.available)}</td>
                <td className={'num ' + (Number(m.shortage) > 0 ? 'red bold' : 'green')}>{Number(m.shortage) > 0 ? qty(m.shortage) : 'Yetarli'}</td>
              </tr>
            ))}
            {mats.data && !mats.data.length && <tr><td colSpan={6} className="empty">{tr("Materiallar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      {complete && <CompleteStageModal task={complete} onClose={() => setComplete(null)} onSaved={() => { setComplete(null); refresh(); toast('Bosqich bajarildi') }} />}
    </Drawer>
  )
}

/* ------------------------------------------------------------ ro'yxat */
export function JobsTab() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ search: '', status: 'new,in_progress', kind: '' })
  const params = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== '')), [f, stamp])
  const { data, error } = useFetch('/production/jobs/', params)
  const [form, setForm] = useState(false)
  const [open, setOpen] = useState(null)
  const rows = data || []
  return (
    <>
      <div className="stats">
        <Stat label={tr("Faol topshiriqlar")} value={rows.filter((j) => ['new', 'in_progress'].includes(j.status)).length} />
        <Stat label={tr("Muddati o'tgan")} value={rows.filter((j) => j.plan_end && j.plan_end < todayISO() && !['done', 'cancelled'].includes(j.status)).length} valueClass="red" />
        <Stat label={tr("Rejada (texkarta bo'yicha)")} value={num(rows.filter((j) => j.techcard).reduce((a, j) => a + Number(j.qty), 0))} sub={`ishlab chiqarildi: ${num(rows.reduce((a, j) => a + Number(j.produced_qty), 0))}`} />
      </div>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          {canCreate(user, 'production') && <button className="btn primary small" onClick={() => setForm(true)}>{tr("+ Topshiriq")}</button>}
          <input placeholder={tr("Raqam, mahsulot, mijoz…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="new,in_progress">{tr("Faollar")}</option>
            {JOB_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="">{tr("Hammasi")}</option>
          </select>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="">{tr("Turi: hammasi")}</option>
            <option value="techcard">{tr("Texkarta bo'yicha")}</option>
            <option value="order">{tr("Mijoz buyurtmasi (smeta)")}</option>
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>№</th><th>{tr("Sana")}</th><th>{tr("Mahsulot / buyurtma")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Ishlab chiqarildi")}</th><th>{tr("Bosqichlar")}</th><th>{tr("Muddat")}</th><th>{tr("Holat")}</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => setOpen(j.id)}>
                  <td className="bold">{j.number}</td>
                  <td>{date(j.date)}</td>
                  <td>{j.title}{j.production_order_number && <div className="small muted">Ishlab chiqarish buyurtmasi №{j.production_order_number}</div>}</td>
                  <td className="num">{qty(j.qty)} {j.product_unit}</td>
                  <td className="num">{j.techcard ? qty(j.produced_qty) : '—'}</td>
                  <td style={{ minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {j.stages.map((s) => (
                        <span key={s.id} title={`${s.operation}: ${qty(s.done_qty)}/${qty(s.plan_qty)}`}
                          style={{ flex: 1, height: 8, borderRadius: 4, background: s.status === 'done' ? '#12a05c' : s.progress > 0 ? 'var(--primary)' : 'var(--surface-3)' }} />
                      ))}
                    </div>
                    <div className="small muted">{Math.round(j.progress * 100)}%</div>
                  </td>
                  <td className={j.plan_end && j.plan_end < todayISO() && !['done', 'cancelled'].includes(j.status) ? 'red' : ''}>{date(j.plan_end)}</td>
                  <td><Badge kind={JOB_BADGE[j.status]}>{j.status_display}</Badge></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">{tr("Topshiriqlar yo'q")}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {form && <JobForm onClose={() => setForm(false)} onSaved={(j) => { setForm(false); setStamp((s) => s + 1); setOpen(j.id); toast(`Topshiriq №${j.number} yaratildi`) }} />}
      {open && <JobCard id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((s) => s + 1)} />}
    </>
  )
}

export function CompletionsTab() {
  const [f, setF] = useState({ date_from: monthStartISO(), date_to: todayISO(), employee: '' })
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/production/completions/', params)
  const emps = useFetch('/hr/employees/')
  const total = (data || []).reduce((a, c) => a + Number(c.amount), 0)
  return (
    <div className="table-wrap">
      <div className="table-toolbar filters">
        <DateInput value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
        <DateInput value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        <select value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
          <option value="">{tr("Ijrochi: hammasi")}</option>
          {(emps.data || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
        </select>
      </div>
      {!data ? <Loading error={error} /> : (
        <table className="t">
          <thead><tr><th>{tr("Sana")}</th><th>{tr("Topshiriq")}</th><th>{tr("Bosqich")}</th><th>{tr("Bo'lim")}</th><th className="num">{tr("Miqdor")}</th><th className="num">{tr("Brak")}</th><th>{tr("Ijrochi")}</th><th className="num">{tr("Ishbay haq")}</th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td>{date(c.date)}</td>
                <td>{c.job_number ? `№${c.job_number} · ` : ''}{c.job_title}</td>
                <td className="bold">{c.operation_name}</td>
                <td>{c.department_name}</td>
                <td className="num">{qty(c.qty)} {c.unit}</td>
                <td className="num">{Number(c.defect_qty) ? qty(c.defect_qty) : '—'}</td>
                <td>{c.employee_name || <span className="muted">—</span>}</td>
                <td className="num">{Number(c.amount) ? money(c.amount, 'UZS') : '—'}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={8} className="empty">{tr("Davr bo'yicha yozuvlar yo'q")}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={7}>{tr("Jami ishbay haq")}</td><td className="num">{money(total, 'UZS')}</td></tr></tfoot>
        </table>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ mehnatga haq */
export function LaborTab() {
  const [f, setF] = useState({ date_from: monthStartISO(), date_to: todayISO() })
  const { data, error } = useFetch('/production/labor/', f)
  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <DateInput value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
        <DateInput value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        {data && <span className="muted">{tr("Jami:")} <b>{money(data.total, 'UZS')}</b></span>}
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{tr("Xodim")}</th><th>{tr("Bosqichlar (miqdor · summa)")}</th><th className="num">{tr("Hisoblangan")}</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employee}>
                  <td className="bold">{r.name}</td>
                  <td className="small">{r.operations.map((o) => `${o.operation}: ${qty(o.qty)} · ${num(o.amount)}`).join('  |  ')}</td>
                  <td className="num bold">{money(r.amount, 'UZS')}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={3} className="empty">{tr("Davr bo'yicha ishbay yozuvlari yo'q")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="legend"><span>{tr("Ishbay haq — bosqich bajarilganda (ijrochi tanlansa) bosqich stavkasi × miqdor. Oylik vedomostga avtomatik tushadi.")}</span></div>
    </>
  )
}

/* ------------------------------------------------------------ ishlab chiqarish holati */
export function StatusTab() {
  const [all, setAll] = useState(false)
  const { data, error } = useFetch('/production/status/', { all: all ? 1 : undefined })
  const [open, setOpen] = useState(null)
  if (!data) return <Loading error={error} />
  const color = { done: '#12a05c', active: 'var(--primary)', blocked: 'var(--red)', waiting: 'var(--surface-3)' }
  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {tr("Bajarilganlarni ham ko'rsatish")}</label>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{tr("Topshiriq")}</th>{data.departments.map((d) => <th key={d.id} style={{ textAlign: 'center' }}>{d.name}</th>)}<th>{tr("Muddat")}</th><th className="num">{tr("Jami")}</th></tr></thead>
          <tbody>
            {data.jobs.map((j) => (
              <tr key={j.id} className="clickable" onClick={() => setOpen(j.id)}>
                <td><b>№{j.number}</b> <span className="small">{j.title}</span></td>
                {data.departments.map((d) => {
                  const c = j.cells[d.id]
                  return (
                    <td key={d.id} style={{ textAlign: 'center' }}>
                      {c ? (
                        <span title={`${Math.round(c.progress * 100)}%`} style={{ display: 'inline-block', minWidth: 44, padding: '2px 6px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                          background: color[c.done], color: c.done === 'waiting' ? 'var(--muted)' : '#fff' }}>{Math.round(c.progress * 100)}%</span>
                      ) : <span className="muted">·</span>}
                    </td>
                  )
                })}
                <td className={j.plan_end && j.plan_end < todayISO() && j.status !== 'done' ? 'red' : ''}>{date(j.plan_end)}</td>
                <td className="num bold">{Math.round(j.progress * 100)}%</td>
              </tr>
            ))}
            {!data.jobs.length && <tr><td colSpan={data.departments.length + 3} className="empty">{tr("Faol topshiriqlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{tr("Yashil — bajarildi")}</span><span>{tr("Ko'k — jarayonda")}</span><span>{tr("Qizil — material yo'q")}</span><span>{tr("Kulrang — kutilmoqda")}</span></div>
      {open && <JobCard id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

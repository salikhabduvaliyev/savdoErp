import { useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorText } from '../../api'
import { useAuth } from '../../auth'
import { Badge, Loading, Progress, Stat, toast, useFetch } from '../../components/ui'
import { date, pct, qty, shortDate } from '../../format'
import { t as tr } from '../../i18n'

function TaskCard({ t, onDone, employees }) {
  const [done, setDone] = useState('')
  const [emp, setEmp] = useState('')
  const call = async (action, body) => {
    try {
      const { data } = await api.post(`/production/tasks/${t.id}/${action}/`, body)
      toast(`${t.job_number ? '№' + t.job_number : t.order_number}: ${data.status_display}`)
    } catch (e) {
      const st = e?.response?.status
      toast(st === 409 ? 'Material yetishmaydi — zayavka ishlab chiqarish menejeriga yuborildi' : errorText(e), true)
    }
    onDone()
  }
  const unit = t.unit
  return (
    <div className={'task' + (t.status === 'in_progress' ? ' active' : '')}>
      <div className="title">
        <span>
          {t.job_number ? <>№{t.job_number} · </> : null}
          {t.order ? <Link to={`/orders/${t.order}`}>{t.order_number}</Link> : null}
          {t.order ? ` · ${t.client_name}` : t.job_title}
        </span>
        <Badge kind={t.status}>{t.status_display}</Badge>
      </div>
      <div className="line">
        Bosqich: <b>{t.operation_name}</b> · Reja: {qty(t.plan_qty)} {unit}
        {Number(t.done_qty) > 0 && <> · Bajarildi: {qty(t.done_qty)} {unit}</>}
        {' · '}Muddat:{' '}
        <span className={t.is_overdue ? 'red' : ''}>{shortDate(t.deadline)}{t.is_overdue && ' ' + tr('({n} kun kechikkan)', { n: t.overdue_days })}</span>
      </div>
      {t.materials.length > 0 && (
        <div className="line muted small">
          Material: {t.materials.map((m) => `${m.name} — ${qty(m.qty)} ${m.unit}${Number(m.reserved) > 0 ? ' (rezervda)' : ''}`).join(' · ')}
          {t.drawing && <> · <a href={t.drawing} target="_blank" rel="noreferrer">{tr("Chizma")}</a></>}
        </div>
      )}
      {t.status === 'blocked' && <div className="line red small">{t.blocked_reason} — zayavka ishlab chiqarish menejeriga yuborildi</div>}
      {['in_progress', 'paused'].includes(t.status) && <div style={{ maxWidth: 400, marginTop: 8 }}><Progress value={t.progress} big /></div>}
      <div className="actions">
        {['waiting', 'paused', 'blocked'].includes(t.status) && (
          <button className="btn primary big" onClick={() => call('start')}>{t.status === 'blocked' ? 'Qayta tekshirish' : 'Boshlash'}</button>
        )}
        {['in_progress', 'paused'].includes(t.status) && (
          <>
            {t.status === 'in_progress' && <button className="btn danger big" onClick={() => call('pause', { reason: window.prompt("To'xtatish sababi:", '') || '' })}>{tr("To'xtatish")}</button>}
            <button className="btn success big" onClick={() => call('finish', { employee: emp || undefined })}>{tr("Tugatish")}</button>
            <input className="cell" style={{ width: 120, padding: 9 }} placeholder={`+ bajarildi, ${unit}`} value={done} onChange={(e) => setDone(e.target.value)} />
            {employees?.length > 0 && (
              <select className="cell" style={{ width: 180, padding: 8 }} value={emp} onChange={(e) => setEmp(e.target.value)}>
                <option value="">{tr("Ijrochi (men)")}</option>
                {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
              </select>
            )}
            <button className="btn" disabled={!done} onClick={() => { call('complete', { qty: done, employee: emp || undefined }); setDone('') }}>{tr("Saqlash")}</button>
          </>
        )}
      </div>
    </div>
  )
}

export function DeptBoard() {
  const { user } = useAuth()
  const deps = useFetch('/production/departments/')
  const [dep, setDep] = useState(user.department || '')
  const [stamp, setStamp] = useState(0)
  const depId = dep || deps.data?.[0]?.id
  const tasks = useFetch(depId ? '/production/tasks/' : null, { department: depId, active: 1, stamp })
  const depName = deps.data?.find((d) => d.id === Number(depId))?.name
  const employees = useFetch('/hr/employees/', { is_active: true, department: depId || '' })

  const order = { in_progress: 0, waiting: 1, paused: 2, blocked: 3 }
  const list = [...(tasks.data || [])].sort((a, b) => order[a.status] - order[b.status])

  return (
    <>
      <div className="page-head">
        <h1>{depName ? `${depName} bo'limi` : "Bo'lim"}</h1>
        <span className="muted">Bugun, {date(new Date().toISOString())} · Bo'lim boshlig'i</span>
        <span className="grow" />
        {!user.own_department_only && (
          <select className="chip" value={depId || ''} onChange={(e) => setDep(e.target.value)}>
            {(deps.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>
      {!tasks.data ? <Loading error={tasks.error} /> : list.length ? (
        list.map((t) => <TaskCard key={t.id} t={t} employees={employees.data || []} onDone={() => setStamp((s) => s + 1)} />)
      ) : <div className="card empty">{tr("Faol topshiriqlar yo'q")}</div>}
    </>
  )
}

export function ProductionDashboard({ title = true }) {
  const { data, error } = useFetch('/dashboard/production/')
  if (!data) return <Loading error={error} />
  const defectBad = data.defect_pct !== null && data.defect_pct > data.defect_norm_pct
  const tone = (p) => (p >= 90 ? 'ok' : p < 50 ? 'warn' : '')
  return (
    <>
      {title && <div className="page-head"><h1>{tr("Ishlab chiqarish dashboardi")}</h1></div>}
      <div className="stats">
        <Stat label={tr("Reja bajarilishi")} value={pct(data.plan_completion_pct)} sub={tr("bugungi reja / fakt")} />
        <Stat label={tr("Muddatida topshirish")} value={pct(data.on_time_pct)} sub={tr("oxirgi 30 kun")} />
        <Stat label={tr("Brak")} value={pct(data.defect_pct)} valueClass={defectBad ? 'red' : ''} sub={tr("me'yor: {n}%", { n: data.defect_norm_pct })} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>{tr("Bo'limlar yuklamasi / bajarilish")}</h2>
          {data.departments.map((d) => (
            <div key={d.id} className="dept-row">
              <div className="top"><span>{d.name}</span><span className="muted">{pct(d.progress_pct)} · {tr("navbatda {n} ta", { n: d.queue })}</span></div>
              <Progress value={(d.progress_pct || 0) / 100} big tone={tone(d.progress_pct)} />
            </div>
          ))}
          {!data.departments.length && <div className="muted">{tr("Bo'limlar hali yaratilmagan")}</div>}
        </div>
        <div>
          <div className="card">
            <h2>{tr("To'xtab qolgan buyurtmalar")}</h2>
            <ul className="list-plain">
              {data.stalled.map((s, i) => (
                <li key={i}><Link to={`/orders/${s.order}`}>{s.number}</Link> · {s.client} · <span className="red">{s.reason}</span></li>
              ))}
              {!data.stalled.length && <li className="muted">{tr("Yo'q")}</li>}
            </ul>
          </div>
          <div className="card">
            <h2>{tr("Material sarfi: me'yor va haqiqat")}</h2>
            <ul className="list-plain">
              {data.consumption.map((c) => (
                <li key={c.material}>
                  {c.material}: <span className={c.deviation_pct > 0 ? 'red' : 'green'}>{c.deviation_pct > 0 ? '+' : ''}{pct(c.deviation_pct)}</span>
                  <span className="muted small"> ({qty(c.fact)} / {qty(c.norm)})</span>
                </li>
              ))}
              {!data.consumption.length && <li className="muted">{tr("Ma'lumot yo'q")}</li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

export function PurchaseRequests() {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/production/purchase-requests/', { stamp })
  const setStatus = async (id, status) => {
    await api.patch(`/production/purchase-requests/${id}/`, { status })
    setStamp((s) => s + 1)
  }
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{tr("Sana")}</th><th>{tr("Material")}</th><th className="num">{tr("Miqdor")}</th><th>{tr("Buyurtma")}</th><th>{tr("Izoh")}</th><th>{tr("Holat")}</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td>{date(r.created_at)}</td>
              <td>{r.material_name}</td>
              <td className="num">{qty(r.qty)}</td>
              <td>{r.order ? <Link to={`/orders/${r.order}`}>{r.order_number}</Link> : '—'}</td>
              <td className="small muted">{r.note}</td>
              <td>
                <select className="chip" value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>
                  <option value="open">{tr("Ochiq")}</option>
                  <option value="ordered">{tr("Buyurtma berildi")}</option>
                  <option value="closed">{tr("Yopildi")}</option>
                </select>
              </td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={6} className="empty">{tr("Zayavkalar yo'q")}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

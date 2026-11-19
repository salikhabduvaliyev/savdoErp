import { useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorText } from '../../api'
import { useAuth } from '../../auth'
import { Badge, Loading, Progress, Stat, toast, useFetch } from '../../components/ui'
import { date, pct, qty, shortDate } from '../../format'
import { cleanNum } from '../../components/DocEditor'
import { t as tr } from '../../i18n'
import { promptDialog } from '../../components/Confirm'
import ExtraMaterials, { extraPayload } from './ExtraMaterials'

/* Bo'lim ekrani (ishni boshlash): katta tugmalar, ketma-ket bosqichlar, ijrochi — kirgan xodim */
function TaskCard({ t, onDone, employees, me }) {
  const ready = Number(t.flow?.ready ?? t.remaining)
  const [done, setDone] = useState('')
  const myEmp = t.operation_employee ? String(t.operation_employee) : me && employees.some((e) => e.id === me.id) ? String(me.id) : ''
  const [extra, setExtra] = useState([])
  const [emp, setEmp] = useState(myEmp)
  const [busy, setBusy] = useState(false)
  const call = async (action, body) => {
    setBusy(true)
    try {
      const { data } = await api.post(`/production/tasks/${t.id}/${action}/`, body)
      toast(`${t.job_number ? '№' + t.job_number : t.order_number}: ${tr(data.status_display)}`)
    } catch (e) {
      const st = e?.response?.status
      toast(st === 409 ? tr('Material yetishmaydi — zayavka ishlab chiqarish menejeriga yuborildi') : errorText(e), true)
    }
    setBusy(false)
    onDone()
  }
  const unit = tr(t.unit)
  const amount = done === '' ? ready : Number(done)
  const running = ['in_progress', 'paused'].includes(t.status)
  const waitingPrev = t.flow?.prev && ready <= 0 && Number(t.remaining) > 0
  return (
    <div className={'tcard ' + t.status + (waitingPrev ? ' waiting-prev' : '')}>
      <div className="tcard-head">
        <div>
          <div className="tcard-title">{t.job_title || `${tr('Buyurtma')} №${t.order_number}`}</div>
          <div className="tcard-sub">
            {t.job_number && <>№{t.job_number}</>}
            {t.order && <> · <Link to={`/orders/${t.order}`}>{tr('Buyurtma')} №{t.order_number}</Link> · {t.client_name}</>}
          </div>
        </div>
        <Badge kind={t.status}>{tr(t.status_display)}</Badge>
      </div>

      <div className="tcard-flow">
        {t.flow?.prev && <span className="muted">{t.flow.prev} ✓ {qty(t.flow.prev_done)}</span>}
        <span className="cur">● {t.operation_name}</span>
        {t.flow?.next && <span className="muted">→ {t.flow.next}</span>}
      </div>

      <div className="tcard-nums">
        <div><small>{tr('Reja')}</small><b>{qty(t.plan_qty)} {unit}</b></div>
        <div><small>{tr('Bajarildi')}</small><b className="green">{qty(t.done_qty)}</b></div>
        <div><small>{tr('Hozir bajarsa bo\'ladi')}</small><b className={ready > 0 ? '' : 'muted'}>{qty(ready)}</b></div>
        <div><small>{tr('Muddat')}</small><b className={t.is_overdue ? 'red' : ''}>{shortDate(t.deadline)}</b></div>
      </div>
      <Progress value={t.progress} big />

      {t.materials.length > 0 && (
        <div className="tcard-mats">
          {t.materials.map((m) => <span key={m.name} className="mat-chip">{m.name} <b>{qty(m.qty)} {tr(m.unit)}</b></span>)}
          {t.drawing && <a href={t.drawing} target="_blank" rel="noreferrer">{tr('Chizma')}</a>}
        </div>
      )}
      {t.status === 'blocked' && <div className="warn-box">{t.blocked_reason}</div>}
      {waitingPrev && <div className="hint">{tr('Oldingi bosqich ({d}) tugatishini kuting', { d: t.flow.prev })}</div>}

      <div className="tcard-actions">
        {['waiting', 'paused', 'blocked'].includes(t.status) && (
          <button className="btn primary huge" disabled={busy || waitingPrev} onClick={() => call('start')}>
            ▶ {t.status === 'blocked' ? tr('Qayta tekshirish') : t.status === 'paused' ? tr('Davom ettirish') : tr('Boshlash')}
          </button>
        )}
        {running && (
          <>
            <div className="qty-stepper">
              <button onClick={() => setDone(String(Math.max(0, amount - 1)))}>−</button>
              <input inputMode="decimal" value={done === '' ? cleanNum(ready) : done} onChange={(e) => setDone(e.target.value)} />
              <button onClick={() => setDone(String(Math.min(ready, amount + 1)))}>+</button>
              <span className="muted">{unit}</span>
            </div>
            <select className="emp-select" value={emp} onChange={(e) => setEmp(e.target.value)} title={tr('Ijrochi — shu xodimga ishbay haq yoziladi')}>
              <option value="">{tr('Ijrochi: tanlanmagan')}</option>
              {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}{me && x.id === me.id ? ` (${tr('men')})` : ''}</option>)}
            </select>
            <button className="btn success huge" disabled={busy || !(amount > 0) || amount > ready}
              onClick={() => { call('complete', { qty: amount, employee: emp || undefined, extra_materials: extraPayload(extra) }); setDone(''); setExtra([]) }}>
              ✓ {tr('Bajarildi')} {qty(amount)} {unit}
            </button>
            {t.status === 'in_progress' && (
              <button className="btn huge-ghost" disabled={busy} onClick={async () => { const r = await promptDialog(tr("To'xtatish sababi:")); if (r !== null) call('pause', { reason: r }) }}>❚❚ {tr("To'xtatish")}</button>
            )}
          </>
        )}
      </div>
      {running && <ExtraMaterials compact value={extra} onChange={setExtra} />}
      {running && amount > ready && <div className="red small">{tr('Oldingi bosqichdan faqat {n} keldi', { n: qty(ready) })}</div>}
    </div>
  )
}

export function DeptBoard() {
  const { user } = useAuth()
  const deps = useFetch('/production/departments/')
  const me = user.employee
  const [dep, setDep] = useState(user.department || me?.department || '')
  const [stamp, setStamp] = useState(0)
  const depId = dep || deps.data?.[0]?.id
  const tasks = useFetch(depId ? '/production/tasks/' : null, { department: depId, active: 1, stamp })
  const depName = deps.data?.find((d) => d.id === Number(depId))?.name
  const employees = useFetch('/hr/employees/', { is_active: true, department: depId || '' })

  const order = { in_progress: 0, paused: 1, waiting: 2, blocked: 3 }
  const list = [...(tasks.data || [])].sort((a, b) => order[a.status] - order[b.status])

  return (
    <>
      <div className="board-head">
        <div>
          <h1>{depName ? tr("{d} bo'limi", { d: depName }) : tr("Bo'lim")}</h1>
          <div className="muted">{tr('Bugun')}, {date(new Date().toISOString())} · {me ? me.full_name : user.full_name}</div>
        </div>
        <span className="grow" />
        {!user.own_department_only && (
          <div className="dep-tabs">
            {(deps.data || []).map((d) => (
              <button key={d.id} className={String(d.id) === String(depId) ? 'active' : ''} onClick={() => setDep(d.id)}>{d.name}</button>
            ))}
          </div>
        )}
      </div>
      {!tasks.data ? <Loading error={tasks.error} /> : list.length ? (
        <div className="tcards">
          {list.map((t) => <TaskCard key={t.id + ':' + stamp} t={t} me={me} employees={employees.data || []} onDone={() => setStamp((s) => s + 1)} />)}
        </div>
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

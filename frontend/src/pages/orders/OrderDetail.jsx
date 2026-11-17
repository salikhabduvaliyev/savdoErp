import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, useAuth } from '../../auth'
import { Badge, Loading, Progress, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty } from '../../format'
import PaymentForm from '../finance/TransactionForm'
import Estimate from './Estimate'
import OrderForm from './OrderForm'
import { STATUSES } from './OrderList'
import { useRefs } from './OrdersPage'
import { t as tr } from '../../i18n'
import Icon from '../../components/Icon'

export default function OrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { data: o, error, reload } = useFetch(`/orders/${id}/`)
  const [tab, setTab] = useState('estimate')
  const [stamp, setStamp] = useState(0)
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(null)
  const refs = useRefs()
  const tasks = useFetch('/production/tasks/', { order: id, stamp })
  const txs = useFetch('/finance/transactions/', { order: id, stamp })
  const shortages = useFetch(`/orders/${id}/shortages/`, { stamp })

  if (!o) return <Loading error={error} />
  const refresh = () => { reload(); setStamp((s) => s + 1) }

  const setStatus = async (status) => {
    try {
      await api.post(`/orders/${id}/set_status/`, { status })
      toast('Status yangilandi')
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }
  const makeSale = async () => {
    try {
      const { data } = await api.post('/sales/from_order/', { order: o.id })
      toast(`Sotuv №${data.number} ${data.status === 'draft' ? 'qoralamasi tayyor' : 'ochildi'}`)
      nav(`/sales?open=${data.id}`)
    } catch (e) { toast(errorText(e), true) }
  }
  const sendToProduction = async () => {
    try {
      const { data } = await api.post(`/orders/${id}/send_to_production/`)
      const short = data.materials.filter((m) => Number(m.shortage) > 0)
      toast(`Topshiriqlar: +${data.created_tasks}. ` + (short.length ? `Yetishmaydi: ${short.map((m) => `${m.material} ${qty(m.shortage)} ${m.unit}`).join(', ')} — zayavka yuborildi` : 'Material rezerv qilindi'), short.length > 0)
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }

  return (
    <>
      <div className="page-head">
        <Link to="/orders" className="muted">{tr("← Buyurtmalar")}</Link>
        <h1>Buyurtma {o.number}</h1>
        <Badge kind={o.status}>{o.status_display}</Badge>
        {o.stage && <span className="muted">Bo'lim: {o.stage}</span>}
        {o.is_overdue && <span className="badge b-low">{o.overdue_days} kun kechikkan</span>}
        <span className="grow" />
        <select className="chip" value={o.status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn icon-only" onClick={() => setEdit(true)} title={tr("Tahrirlash")}><Icon name="edit" size={16} /></button>
        {['new', 'confirmed', 'in_production'].includes(o.status) && <button className="btn" onClick={sendToProduction}>{tr("Bo'limlarga yuborish")}</button>}
        {['ready', 'delivered'].includes(o.status) && canCreate(user, 'sales') && (
          <button className="btn primary" onClick={makeSale}>{o.is_sold ? 'Sotuvni ochish' : 'Sotuv qilish'}</button>
        )}
      </div>

      <div className="stats">
        <Stat label={tr("Mijoz")} value={o.client_name} sub={`Sana: ${date(o.date)} · Menejer: ${o.manager_name || '—'}`} />
        <Stat label={tr("Summa")} value={money(o.amount, o.currency)} sub={`To'langan: ${money(o.paid, o.currency)}`} />
        <Stat label={tr("Qarz")} value={money(o.debt, o.currency)} valueClass={Number(o.debt) > 0 ? 'red' : 'green'} />
        <Stat
          label={tr("Muddatlar")}
          value={date(o.plan_date)}
          valueClass={o.is_overdue ? 'red' : ''}
          sub={`Ishlab chiqarish kuni: ${date(o.production_date)} · Bajarilish ${Math.round(o.progress * 100)}%`}
        />
      </div>

      <div className="tabs">
        {[['estimate', tr("Smeta (tannarx)")], ['tasks', tr("Ishlab chiqarish")], ['payments', tr("To'lovlar va xarajatlar")], ['materials', tr("Material")]].map(([k, l]) => (
          <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'estimate' && <Estimate key={stamp} order={o} onChanged={refresh} />}

      {tab === 'tasks' && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{tr("Bo'lim")}</th><th>{tr("Operatsiya")}</th><th className="num">{tr("Reja")}</th><th className="num">{tr("Bajarildi")}</th><th>{tr("Bajarilish")}</th><th>{tr("Muddat")}</th><th>{tr("Holat")}</th></tr></thead>
            <tbody>
              {(tasks.data || []).map((t) => (
                <tr key={t.id}>
                  <td>{t.department_name}</td>
                  <td>{t.operation_name}</td>
                  <td className="num">{qty(t.plan_qty)} {t.unit}</td>
                  <td className="num">{qty(t.done_qty)} {t.unit}</td>
                  <td style={{ width: 160 }}><Progress value={t.progress} /></td>
                  <td className={t.is_overdue ? 'red' : ''}>{date(t.deadline)}</td>
                  <td><Badge kind={t.status}>{t.status_display}</Badge>{t.blocked_reason && <div className="small red">{t.blocked_reason}</div>}</td>
                </tr>
              ))}
              {tasks.data && !tasks.data.length && <tr><td colSpan={7} className="empty">{tr("Topshiriqlar yo'q. \"Bo'limlarga yuborish\" smetaning B blokidan topshiriq yaratadi.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <>
          <div className="filters" style={{ marginBottom: 10 }}>
            <button className="btn primary" onClick={() => setPay('client_payment')}>{tr("+ Mijoz to'lovi")}</button>
            <button className="btn" onClick={() => setPay('expense')}>{tr("+ Buyurtma xarajati")}</button>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{tr("Sana")}</th><th>{tr("Turi")}</th><th>{tr("Izoh")}</th><th>{tr("Hisob")}</th><th className="num">{tr("Summa")}</th><th className="num">{tr("Buyurtma valyutasida")}</th></tr></thead>
              <tbody>
                {(txs.data?.results || []).map((t) => (
                  <tr key={t.id}>
                    <td>{date(t.date)}</td>
                    <td>{tr(t.kind_display)}</td>
                    <td>{t.description || t.category_name}</td>
                    <td>{t.account_name}</td>
                    <td className={'num ' + (t.direction === 'in' ? 'green' : 'red')}>{money(t.direction === 'in' ? t.amount : -t.amount, t.currency, { sign: true })}</td>
                    <td className="num muted">{t.currency !== o.currency ? money(t.order_amount, o.currency) : ''}</td>
                  </tr>
                ))}
                {txs.data && !txs.data.results.length && <tr><td colSpan={6} className="empty">{tr("Hali to'lov yo'q")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'materials' && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{tr("Material")}</th><th className="num">{tr("Kerak (chiqindi bilan, berilgani ayirilgan)")}</th><th className="num">{tr("Yetishmaydi")}</th></tr></thead>
            <tbody>
              {(shortages.data || []).map((m) => (
                <tr key={m.material_id}>
                  <td>{m.material}</td>
                  <td className="num">{qty(m.need)} {m.unit}</td>
                  <td className={'num ' + (Number(m.shortage) > 0 ? 'red bold' : 'green')}>{Number(m.shortage) > 0 ? `${qty(m.shortage)} ${m.unit}` : 'Yetarli'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && <OrderForm refs={refs} order={o} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh() }} />}
      {pay && (
        <PaymentForm
          kind={pay}
          order={o}
          onClose={() => setPay(null)}
          onSaved={() => { setPay(null); refresh() }}
        />
      )}
    </>
  )
}

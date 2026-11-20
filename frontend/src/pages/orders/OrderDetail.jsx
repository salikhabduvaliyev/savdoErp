import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canEdit, useAuth } from '../../auth'
import { Badge, Loading, Progress, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty } from '../../format'
import PaymentForm from '../finance/TransactionForm'
import Estimate from './Estimate'
import { Positions } from '../../components/DocEditor'
import OrderForm from './OrderForm'
import { StateBadge, useOrderStates } from './OrderStates'
import { useRefs } from './OrdersPage'
import { t as tr } from '../../i18n'
import Icon from '../../components/Icon'
import { TechCardForm } from '../production/TechCardForm'
import { OrderFiles, ProcessJobModal } from './OrderJobs'

export default function OrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { data: o, error, reload } = useFetch(`/orders/${id}/`)
  const [tab, setTab] = useState('items')
  const [stamp, setStamp] = useState(0)
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(null)
  const refs = useRefs()
  const states = useOrderStates()
  const tasks = useFetch('/production/tasks/', { order: id, stamp })
  const txs = useFetch('/finance/transactions/', { order: id, stamp })
  const jobs = useFetch('/production/jobs/', { order: id, stamp })
  const files = useFetch(`/orders/${id}/files/`, { stamp })
  const [procJob, setProcJob] = useState(false)

  if (!o) return <Loading error={error} />
  const refresh = () => { reload(); setStamp((s) => s + 1) }

  const setStatus = async (state) => {
    try {
      await api.post(`/orders/${id}/set_status/`, { state })
      toast('Status yangilandi')
      refresh()
    } catch (e) { toast(errorText(e), true) }
  }
  const makeSale = async () => {
    try {
      // mavjud sotuv bo'lsa — ochiladi; aks holda buyurtma qiymatlari bilan yangi sotuv formasi
      const { data } = await api.get('/sales/', { params: { order: o.id } })
      const ex = (data.results || data).find((s) => s.status !== 'cancelled')
      nav(ex ? `/sales?open=${ex.id}` : `/sales?from_order=${o.id}`)
    } catch (e) { toast(errorText(e), true) }
  }
  const sendToProduction = async () => {
    try {
      const { data } = await api.post(`/orders/${id}/send_to_production/`)
      if (data.production_order) {
        toast(tr('Ishlab chiqarish buyurtmasi №{n} — ishni boshlang', { n: data.production_order_number }))
        nav(`/production?tab=orders&po=${data.production_order}`)
        return
      }
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
        <StateBadge order={o} />
        {o.stage && <span className="stage-chip current">● {tr('Hozir')}: {o.stage}</span>}
        {o.is_overdue && <span className="badge b-low">{o.overdue_days} kun kechikkan</span>}
        <span className="grow" />
        <select className="chip" value={o.state || ''} onChange={(e) => setStatus(e.target.value)}>
          {states.map((s) => <option key={s.id} value={s.id}>{tr(s.name)}</option>)}
        </select>
        <button className="btn icon-only" onClick={() => setEdit(true)} title={tr("Tahrirlash")}><Icon name="edit" size={16} /></button>
        {['new', 'confirmed'].includes(o.status) && !o.production_orders?.length && o.has_techcard && <button className="btn primary" onClick={sendToProduction}><Icon name="production" size={16} /> {tr("Ishlab chiqarishga yuborish")}</button>}
        {(() => {
          const active = (jobs.data?.results || jobs.data || []).filter((j) => !['cancelled'].includes(j.status))
          return <>
            {active.map((j) => <Link key={'j' + j.id} className="btn" to={`/production?tab=jobs&job=${j.id}`}><Icon name="production" size={16} /> {tr('Topshiriq')} №{j.number}</Link>)}
            {!['delivered', 'cancelled'].includes(o.status) && !o.production_orders?.length && !active.some((j) => j.status !== 'done') && canEdit(user, 'orders') && (
              <button className={'btn' + (o.has_techcard ? '' : ' primary')} onClick={() => setProcJob(true)} title={tr("Mahsulotsiz: texjarayon bosqichlari va kv bo'yicha")}>
                <Icon name="production" size={16} /> {tr('Ishlab chiqarishga (texjarayon)')}
              </button>
            )}
          </>
        })()}
        {o.production_orders?.map((po) => <Link key={po.id} className="btn" to={`/production?tab=orders&po=${po.id}`}><Icon name="production" size={16} /> {tr('Ishlab chiqarish')} №{po.number}</Link>)}
        {o.status !== 'cancelled' && canCreate(user, 'sales') && (
          o.production_pending?.length
            ? <span className="badge b-in_production" title={o.production_pending.join(', ')}>{tr('Ishlab chiqarishda — tugagach sotiladi')}</span>
            : <button className="btn success" onClick={makeSale}><Icon name="sales" size={16} /> {o.is_sold ? tr('Sotuvni ochish') : tr('Sotuvga berish')}</button>
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
        {[['items', tr("Pozitsiyalar") + (o.items?.length ? ` (${o.items.length})` : '')], ['estimate', tr("Smeta (tannarx)")], ['tasks', tr("Ishlab chiqarish")], ['payments', tr("To'lovlar va xarajatlar")], ['materials', tr("Material")], ['files', tr("Fayllar") + (files.data?.length ? ` (${files.data.length})` : '')]].map(([k, l]) => (
          <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'items' && (o.items?.length ? (
        <Positions readOnly showStock={false} currency={o.currency} setLines={() => {}}
          lines={o.items.map((i) => ({ key: i.id, product: i.product, name: i.name, code: i.product_code || '', unit: i.unit, qty: i.qty, price: i.price, discount_pct: i.discount_pct }))} />
      ) : <div className="card empty">{tr("Pozitsiyalar yo'q — buyurtma umumiy summa bilan kiritilgan.")} <button className="link-btn" onClick={() => setEdit(true)}>{tr("Pozitsiya qo'shish")}</button></div>)}
      {tab === 'estimate' && <Estimate key={stamp} order={o} onChanged={refresh} />}
      {tab === 'files' && <OrderFiles orderId={o.id} editable={canEdit(user, 'orders')} onChanged={() => setStamp((s) => s + 1)} />}
      {procJob && <ProcessJobModal order={o} onClose={() => setProcJob(false)} onSaved={() => { setProcJob(false); setTab('tasks'); refresh() }} />}

      {tab === 'tasks' && (tasks.data || []).length > 0 && (
        <div className="stage-flow" style={{ marginBottom: 12 }}>
          {Object.values((tasks.data || []).reduce((acc, t) => {
            const k = t.department_name
            const a = acc[k] || (acc[k] = { name: k, plan: 0, done: 0, status: 'done' })
            a.plan += Number(t.plan_qty); a.done += Number(t.done_qty)
            if (t.status !== 'done') a.status = a.status === 'current' ? 'current' : 'waiting'
            return acc
          }, {})).map((d) => (
            <div key={d.name} className={'stage-chip ' + (d.done >= d.plan ? 'done' : o.stage === d.name ? 'current' : '')}>
              {d.done >= d.plan ? '✓' : o.stage === d.name ? '●' : '○'} {d.name} <small>{qty(d.done)}/{qty(d.plan)}</small>
            </div>
          ))}
        </div>
      )}
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
              {tasks.data && !tasks.data.length && <tr><td colSpan={7} className="empty">{tr("Topshiriqlar yo'q. \"Ishlab chiqarishga yuborish\" — pozitsiyalardan ishlab chiqarish buyurtmasi (yoki smetaning B blokidan topshiriq) yaratadi.")}</td></tr>}
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

      {tab === 'materials' && <OrderMaterials key={stamp} order={o} />}

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

/* Buyurtma → Material (MoySklad: texkarta me'yori × buyurtma miqdori) */
function OrderMaterials({ order }) {
  const [stamp, setStamp] = useState(0)
  const [tc, setTc] = useState(null)
  const [open, setOpen] = useState({})
  const { data, error } = useFetch(`/orders/${order.id}/material_plan/`, { stamp })
  const techcards = useFetch(tc?.id ? `/production/techcards/${tc.id}/` : null)
  if (!data) return <Loading error={error} />
  const short = data.rows.filter((r) => Number(r.shortage) > 0).length
  return (
    <>
      {data.products.length > 0 && (
        <div className="om-products">
          {data.products.map((p) => (
            <div key={p.item} className={'om-prod' + (p.needs_techcard ? ' warn' : '')}>
              <div><b>{p.name}</b> <span className="muted">× {qty(p.qty)} {tr(p.unit)}</span></div>
              {p.techcard
                ? <button type="button" className="link-btn small" onClick={() => setTc({ id: p.techcard })}><Icon name="production" size={13} /> {p.techcard_name}</button>
                : p.needs_techcard
                  ? <button type="button" className="link-btn small red" onClick={() => setTc({ product: p.product })}>{tr("Texkarta yo'q — yaratish")}</button>
                  : <span className="small muted">{tr("tayyor tovar (texkartasiz)")}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="t">
          <thead><tr>
            <th>{tr('Material')}</th><th className="num">{tr('Kerak')}</th><th className="num">{tr('Berilgan')}</th><th className="num">{tr('Qolgan')}</th>
            <th className="num">{tr('Rezerv')}</th><th className="num">{tr("Omborda bo'sh")}</th><th className="num">{tr('Yetishmaydi')}</th>
          </tr></thead>
          <tbody>
            {data.rows.map((m) => [
              <tr key={m.material} className="clickable" onClick={() => setOpen((o) => ({ ...o, [m.material]: !o[m.material] }))}>
                <td><Icon name={open[m.material] ? 'chevron-down' : 'chevron-right'} size={13} /> {m.code && <b className="pos-code">{m.code}</b>} {m.name}</td>
                <td className="num bold">{qty(m.need)} {tr(m.unit)}</td>
                <td className="num">{Number(m.issued) ? qty(m.issued) : '—'}</td>
                <td className="num">{qty(m.left)}</td>
                <td className="num">{Number(m.reserved) ? qty(m.reserved) : '—'}</td>
                <td className={'num ' + (Number(m.available) < 0 ? 'red' : '')}>{qty(m.available)}</td>
                <td className={'num ' + (Number(m.shortage) > 0 ? 'red bold' : 'green')}>{Number(m.shortage) > 0 ? `${qty(m.shortage)} ${tr(m.unit)}` : tr('Yetarli')}</td>
              </tr>,
              open[m.material] && m.sources.map((s, i) => (
                <tr key={`${m.material}-${i}`} className="om-src">
                  <td colSpan={7}>
                    {s.kind === 'techcard'
                      ? <>{s.label}: {qty(s.qty)} × {qty(s.norm)} {tr(m.unit)} ({tr("texkarta me'yori")}) = <b>{qty(s.need)} {tr(m.unit)}</b></>
                      : <>{s.label}: <b>{qty(s.need)} {tr(m.unit)}</b> ({tr('chiqindi bilan')})</>}
                  </td>
                </tr>
              )),
            ])}
            {!data.rows.length && <tr><td colSpan={7} className="empty">{tr("Material ehtiyoji yo'q: pozitsiyalardagi mahsulotlarga texkarta biriktiring yoki smetaning A blokini to'ldiring.")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">{short > 0 ? tr('{n} ta material yetishmaydi.', { n: short }) + ' ' : ''}{tr("Kerak = texkarta me'yori ÷ chiqish miqdori × buyurtmadagi miqdor (+ smeta). Qatorni bosing — hisob tafsiloti.")}</p>
      {tc && (tc.product || techcards.data) && (
        <TechCardForm item={tc.product ? null : techcards.data} presetProduct={tc.product}
          onClose={() => setTc(null)} onSaved={() => { setTc(null); setStamp((x) => x + 1) }} />
      )}
    </>
  )
}

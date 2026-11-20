import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { Loading, toast, useFetch } from '../../components/ui'
import { money, pct, shortDate, todayISO, WEEKDAYS } from '../../format'
import { t } from '../../i18n'

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00')
  const wd = (d.getDay() + 6) % 7
  return addDays(iso, -wd)
}

export default function OrderCalendar({ stamp }) {
  const nav = useNavigate()
  const [start, setStart] = useState(() => mondayOf(todayISO()))
  const [over, setOver] = useState(null)
  const [by, setByState] = useState(() => { try { return localStorage.getItem('erp.calendar.by') || 'production' } catch { return 'production' } })
  const setBy = (v) => { setByState(v); try { localStorage.setItem('erp.calendar.by', v) } catch { /* ignore */ } }
  const { data, error, reload } = useFetch('/orders/calendar/', { start, days: 7, by, stamp })
  const today = todayISO()

  const drop = async (e, day) => {
    e.preventDefault()
    setOver(null)
    const id = Number(e.dataTransfer.getData('text/plain'))
    try {
      await api.post(`/orders/${id}/move/`, by === 'plan' ? { plan_date: day } : { production_date: day })
      toast(`${by === 'plan' ? t('Topshirish muddati') : t('Ishlab chiqarish kuni')}: ${shortDate(day)}`)
      reload()
    } catch (err) {
      toast(errorText(err), true)
    }
  }

  const card = (o) => (
    <div
      key={o.id}
      className={`ccard s-${o.status}` + (o.is_overdue ? ' late' : '')}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(o.id))}
      onClick={() => nav(`/orders/${o.id}`)}
      title={by === 'plan' ? `${t('Ishlab chiqarish kuni')}: ${o.production_date ? shortDate(o.production_date) : '—'}` : `${t('Mijozga topshirish')}: ${shortDate(o.plan_date)}`}
    >
      <b>{o.number}</b> {o.client_name}
      <div>{money(o.amount, o.currency)}{o.progress > 0 && ` · ${Math.round(o.progress * 100)}%`}</div>
      <div>{o.is_overdue ? <span className="red">{t('Kechikkan {n} kun', { n: o.overdue_days })}</span> : o.stage || t(o.status_display)}</div>
    </div>
  )

  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <button className="btn small ghost" onClick={() => setStart(addDays(start, -7))}>{t("‹ Oldingi hafta")}</button>
        <button className="btn small ghost" onClick={() => setStart(mondayOf(today))}>{t("Bugun")}</button>
        <button className="btn small ghost" onClick={() => setStart(addDays(start, 7))}>{t("Keyingi hafta ›")}</button>
        <div className="segmented cal-by" title={t("Kalendar qaysi sana bo'yicha")}>
          <button className={by === 'production' ? 'active' : ''} onClick={() => setBy('production')}>{t('Ishlab chiqarish kuni')}</button>
          <button className={by === 'plan' ? 'active' : ''} onClick={() => setBy('plan')}>{t('Topshirish muddati')}</button>
        </div>
        {data && <span className="muted small">{t("Kunlik sig'im")}: {data.capacity} m²</span>}
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="cal">
            {data.days.map((d, i) => (
              <div
                key={d.date}
                className={'cal-day' + (d.date === today ? ' today' : '') + (over === d.date ? ' drop' : '')}
                onDragOver={(e) => { e.preventDefault(); setOver(d.date) }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => drop(e, d.date)}
              >
                <div className="cal-head">
                  <div className="d">{WEEKDAYS[i]} {d.date.slice(8)}{d.date === today && ' · bugun'}</div>
                  <div className={'l' + (d.overload ? ' red bold' : '')}>Yuklama {pct(d.load_pct)}{d.overload && ' ⚠'}</div>
                  <div className="progress" style={{ marginTop: 4 }}>
                    <div className={d.overload ? 'over' : ''} style={{ width: Math.min(100, d.load_pct) + '%' }} />
                  </div>
                </div>
                <div className="cal-body">{d.cards.map(card)}</div>
              </div>
            ))}
          </div>
          {data.unscheduled.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 8 }}>Rejalashtirilmagan ({data.unscheduled.length}) — kalendarga sudrang</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.unscheduled.map((o) => <div key={o.id} style={{ width: 200 }}>{card(o)}</div>)}
              </div>
            </div>
          )}
        </>
      )}
      <div className="legend">
        <span>{t("Rang — status bo'yicha")}</span>
        <span>{t("Qizil chegara — kechikkan")}</span>
        <span>{t("Yuklama 100% dan oshsa ogohlantirish")}</span>
        <span>{by === 'plan' ? t("Kartochkani sudrab mijozga topshirish muddati o'zgartiriladi") : t("Kartochkani sudrab ishlab chiqarish kuni o'zgartiriladi (mijozga topshirish muddati o'zgarmaydi)")}</span>
      </div>
    </>
  )
}

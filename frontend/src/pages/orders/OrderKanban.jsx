import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { Loading, MoneyBag, Progress, toast, useFetch } from '../../components/ui'
import { money, shortDate } from '../../format'
import { t } from '../../i18n'

export default function OrderKanban({ stamp }) {
  const nav = useNavigate()
  const { data, error, reload, setData } = useFetch('/orders/kanban/', { stamp })
  const [over, setOver] = useState(null)

  if (!data) return <Loading error={error} />

  const drop = async (e, state) => {
    e.preventDefault()
    setOver(null)
    const id = Number(e.dataTransfer.getData('text/plain'))
    const from = data.find((c) => c.cards.some((x) => x.id === id))
    if (!from || from.state === state) return
    // optimistik yangilash
    const card = from.cards.find((x) => x.id === id)
    setData(data.map((c) => {
      if (c.state === from.state) return { ...c, cards: c.cards.filter((x) => x.id !== id), count: c.count - 1 }
      if (c.state === state) return { ...c, cards: [{ ...card, state }, ...c.cards], count: c.count + 1 }
      return c
    }))
    try {
      await api.post(`/orders/${id}/set_status/`, { state })
      toast(`#${card.number} → ${data.find((c) => c.state === state).label}`)
    } catch (err) {
      toast(errorText(err), true)
    }
    reload()
  }

  return (
    <>
      <div className="kanban">
        {data.map((col) => (
          <div
            key={col.state}
            className={'kcol' + (over === col.state ? ' drop' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(col.state) }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, col.state)}
          >
            <div className="kcol-head" style={{ borderTop: `3px solid ${col.color}` }}>
              <h3>{t(col.label)}</h3>
              <div className="sub">
                {col.count} ta{col.count > 0 && <> · <MoneyBag bag={col.total} inline /></>}
              </div>
            </div>
            {col.cards.map((o) => (
              <div
                key={o.id}
                className={'kcard' + (o.is_overdue ? ' overdue' : '')}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(o.id))}
                onClick={() => nav(`/orders/${o.id}`)}
              >
                <b>{o.number}</b> · {o.client_name}
                <div>{money(o.amount, o.currency)}</div>
                <div className="small">
                  {o.is_overdue && <span className="red">Kechikkan {o.overdue_days} kun · </span>}
                  {o.stage ? o.stage : `Muddat: ${shortDate(o.plan_date)}`}
                  {Number(o.debt) > 0 && <span className="muted"> · qarz {money(o.debt, o.currency)}</span>}
                </div>
                <Progress value={o.progress} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="legend">
        <span>{t("Kartochkani ustunlar orasida sudrab status o'zgartiriladi.")}</span>
        <span>{t("Ustun tepasida soni va jami summa valyuta bo'yicha alohida.")}</span>
        <span>{t("\"Topshirildi\" ustunida oxirgi 14 kun.")}</span>
      </div>
    </>
  )
}

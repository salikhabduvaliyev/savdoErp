import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { CustomFieldInputs, useCustomFields } from '../../components/CustomFields'
import { Badge, Loading, Stat, toast, useFetch } from '../../components/ui'
import { date, money, qty } from '../../format'
import { t } from '../../i18n'

const KIND_OPTIONS = [['individual', t("Jismoniy shaxs")], ['legal', t("Yuridik shaxs")]]
const EMPTY = {
  name: '', code: '', kind: 'individual', groups: [], status: '', owner: '', phone: '', phone2: '', email: '', address: '',
  contact_person: '', inn: '', bank_name: '', bank_mfo: '', bank_account: '', source: '', supplies: '', price_type: '',
  note: '', is_active: true, extra: {},
}

function GroupPicker({ groups, value, onChange, disabled }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {groups.map((g) => {
        const on = value.includes(g.id)
        return (
          <button key={g.id} type="button" disabled={disabled} onClick={() => toggle(g.id)} className="chip-group"
            style={{ borderColor: g.color, color: on ? '#fff' : g.color, background: on ? g.color : 'transparent', cursor: 'pointer' }}>
            {on ? '✓ ' : '+ '}{g.name}
          </button>
        )
      })}
      {!groups.length && <span className="muted small">{t("Guruhlar yo'q — ro'yxat sahifasida qo'shing")}</span>}
    </div>
  )
}

function Notes({ cpId, notes, onAdded, user }) {
  const [text, setText] = useState('')
  const add = async () => {
    if (!text.trim()) return
    try {
      await api.post('/crm/notes/', { counterparty: cpId, text })
      setText('')
      onAdded()
    } catch (e) { toast(errorText(e), true) }
  }
  const remove = async (n) => {
    try { await api.delete(`/crm/notes/${n.id}/`); onAdded() } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="field">
        <label>{t('Izoh yozish')}</label>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Nima bo\'ldi? Qo\'ng\'iroq, uchrashuv, kelishuv…')} />
      </div>
      <div className="form-actions" style={{ marginTop: 8 }}><button className="btn primary small" disabled={!text.trim()} onClick={add}>{t('Qo\'shish')}</button></div>
      <div style={{ marginTop: 8 }}>
        {notes.map((n) => (
          <div key={n.id} className="note">
            <div className="meta">{n.author || '—'} · {date(n.created_at)} {new Date(n.created_at).toLocaleTimeString().slice(0, 5)}
              {(n.author === user.full_name || canDelete(user, 'counterparties')) && <> · <button className="link-btn small red" onClick={() => remove(n)}>{t("o'chirish")}</button></>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
          </div>
        ))}
        {!notes.length && <div className="empty">{t("Hodisalar yo'q")}</div>}
      </div>
    </>
  )
}

function Documents({ card }) {
  return (
    <>
      <h3 style={{ marginBottom: 8 }}>{t('Buyurtmalar')} ({card.orders.length})</h3>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>№</th><th>{t('Sana')}</th><th className="num">{t('Summa')}</th><th className="num">{t('Qarz')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>
            {card.orders.map((o) => (
              <tr key={o.id}><td><Link to={`/orders/${o.id}`}>{o.number}</Link></td><td>{date(o.date)}</td>
                <td className="num">{money(o.amount, o.currency)}</td>
                <td className="num bold">{Number(o.debt) ? money(o.debt, o.currency) : (o.is_sold ? <span className="small muted">{t('sotuvda')}</span> : '—')}</td>
                <td><Badge kind={o.status}>{t(o.status_display)}</Badge></td></tr>
            ))}
            {!card.orders.length && <tr><td colSpan={5} className="empty">{t("Buyurtmalar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>{t('Sotuvlar')} ({card.sales.length})</h3>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>№</th><th>{t('Sana')}</th><th className="num">{t('Summa')}</th><th className="num">{t('Qarz')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>
            {card.sales.map((s) => (
              <tr key={s.id}><td><Link to={`/sales?open=${s.id}`}>{s.number}</Link></td><td>{date(s.date)}</td>
                <td className="num">{money(s.total, s.currency)}</td><td className="num bold">{Number(s.debt) ? money(s.debt, s.currency) : '—'}</td>
                <td><Badge kind={s.status}>{t(s.status_display)}</Badge></td></tr>
            ))}
            {!card.sales.length && <tr><td colSpan={5} className="empty">{t("Sotuvlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>{t('Ombor kirimlari')} ({card.moves.length})</h3>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{t('Sana')}</th><th>{t('Tovar')}</th><th className="num">{t('Miqdor')}</th><th className="num">{t('Summa')}</th></tr></thead>
          <tbody>
            {card.moves.map((m) => (
              <tr key={m.id}><td>{date(m.date)}</td><td>{m.material_name}</td><td className="num">{qty(m.qty)} {m.unit}</td><td className="num">{money(m.amount, m.currency)}</td></tr>
            ))}
            {!card.moves.length && <tr><td colSpan={4} className="empty">{t("Kirimlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>{t("To'lovlar")} ({card.transactions.length})</h3>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{t('Sana')}</th><th>{t('Turi')}</th><th>{t('Izoh')}</th><th>{t('Hisob')}</th><th className="num">{t('Summa')}</th></tr></thead>
          <tbody>
            {card.transactions.map((x) => (
              <tr key={x.id}><td>{date(x.date)}</td><td className="small">{t(x.kind_display)}</td>
                <td>{x.description || '—'}</td><td>{x.account_name}</td>
                <td className={'num ' + (x.direction === 'in' ? 'green' : 'red')}>{money(x.direction === 'in' ? x.amount : -x.amount, x.currency, { sign: true })}</td></tr>
            ))}
            {!card.transactions.length && <tr><td colSpan={5} className="empty">{t("To'lovlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function CounterpartyPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const { user } = useAuth()
  const editable = isNew ? canCreate(user, 'counterparties') : canEdit(user, 'counterparties')
  const [stamp, setStamp] = useState(0)
  const card = useFetch(isNew ? null : `/crm/counterparties/${id}/card/`, { stamp })
  const groups = useFetch('/crm/groups/')
  const statuses = useFetch('/crm/statuses/')
  const pts = useFetch('/warehouse/price-types/')
  const users = useFetch('/auth/users-lookup/')
  const debts = useFetch(isNew ? null : '/crm/counterparties/', { with_debt: 1, search: '' })
  const fields = useCustomFields('counterparty')
  const [v, setV] = useState(isNew ? { ...EMPTY } : null)
  const [tab, setTab] = useState('events')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (card.data) {
      const c = card.data.counterparty
      setV({ ...EMPTY, ...c, status: c.status || '', owner: c.owner || '', price_type: c.price_type || '', extra: c.extra || {} })
    }
  }, [card.data])
  useEffect(() => {
    if (isNew && statuses.data?.length && !v?.status) setV((s) => ({ ...s, status: statuses.data[0].id }))
  }, [statuses.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <Loading error={card.error} />
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const status = (statuses.data || []).find((s) => String(s.id) === String(v.status))
  const myDebt = (debts.data || []).find((r) => String(r.id) === String(id))

  const save = async (close) => {
    setBusy(true)
    setError(null)
    const payload = {}
    Object.keys(EMPTY).forEach((k) => { payload[k] = v[k] })
    for (const k of ['status', 'owner', 'price_type']) payload[k] = payload[k] || null
    try {
      const { data } = isNew ? await api.post('/crm/counterparties/', payload) : await api.patch(`/crm/counterparties/${id}/`, payload)
      toast(t('Saqlandi'))
      if (close) nav('/counterparties')
      else if (isNew) nav(`/counterparties/${data.id}`, { replace: true })
      else setStamp((s) => s + 1)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  const row = (label, input) => <div className="row"><label>{t(label)}</label>{input}</div>
  const dis = !editable

  return (
    <>
      <div className="doc-bar">
        {editable && <button className="btn primary" disabled={busy || !v.name.trim()} onClick={() => save(false)}>{t('Saqlash')}</button>}
        {editable && <button className="btn" disabled={busy || !v.name.trim()} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>}
        <button className="btn ghost" onClick={() => nav('/counterparties')}>{t('Yopish')}</button>
        <span style={{ flex: 1 }} />
        {!isNew && card.data && <span className="small muted">{t('Yaratilgan')}: {date(card.data.counterparty.created_at)}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="small muted" style={{ marginBottom: 4 }}>* {t('Nomi')}</div>
      <input className="doc-title" value={v.name} onChange={set('name')} placeholder={t('Kontragent nomi yoki F.I.Sh.')} disabled={dis} autoFocus={isNew} />

      <div className="doc-layout">
        <div className="card side-form">
          <h2>{t('Kontragent haqida')}</h2>
          {row('Holat', (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={v.status ?? ''} onChange={set('status')} disabled={dis} style={{ borderLeft: `4px solid ${status?.color || 'var(--border)'}` }}>
                <option value="">—</option>
                {(statuses.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ))}
          {row('Guruhlar', <GroupPicker groups={groups.data || []} value={v.groups} onChange={(g) => setV({ ...v, groups: g })} disabled={dis} />)}
          {row('Turi', (
            <select value={v.kind} onChange={set('kind')} disabled={dis}>{KIND_OPTIONS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
          ))}
          {row('Telefon', <input value={v.phone} onChange={set('phone')} disabled={dis} placeholder="+998" />)}
          {row("Qo'shimcha telefon", <input value={v.phone2} onChange={set('phone2')} disabled={dis} />)}
          {row('Email', <input type="email" value={v.email} onChange={set('email')} disabled={dis} />)}
          {row('Manzil', <textarea rows={2} value={v.address} onChange={set('address')} disabled={dis} />)}
          {row('Izoh', <textarea rows={3} value={v.note} onChange={set('note')} disabled={dis} />)}
          {row("Mas'ul xodim", (
            <select value={v.owner ?? ''} onChange={set('owner')} disabled={dis}>
              <option value="">—</option>
              {(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          ))}
          <details open={!!(v.contact_person || v.code || v.price_type || v.source || v.supplies)}>
            <summary>{t("Qo'shimcha")}</summary>
            {row('Kod', <input value={v.code} onChange={set('code')} disabled={dis} />)}
            {row("Mas'ul shaxs", <input value={v.contact_person} onChange={set('contact_person')} disabled={dis} />)}
            {row('Narx turi (sotuvda)', (
              <select value={v.price_type ?? ''} onChange={set('price_type')} disabled={dis}>
                <option value="">—</option>
                {(pts.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ))}
            {row('Qayerdan keldi', <input value={v.source} onChange={set('source')} disabled={dis} />)}
            {row('Nima yetkazadi', <input value={v.supplies} onChange={set('supplies')} disabled={dis} />)}
            {row('Faol', <label className="check"><input type="checkbox" checked={v.is_active} onChange={set('is_active')} disabled={dis} /> {t('Ha')}</label>)}
          </details>
          <details open={!!(v.inn || v.bank_account)}>
            <summary>{t('Rekvizitlar')}</summary>
            {row('STIR', <input value={v.inn} onChange={set('inn')} disabled={dis} />)}
            {row('Bank', <input value={v.bank_name} onChange={set('bank_name')} disabled={dis} />)}
            {row('MFO', <input value={v.bank_mfo} onChange={set('bank_mfo')} disabled={dis} />)}
            {row('Hisob raqam', <input value={v.bank_account} onChange={set('bank_account')} disabled={dis} />)}
          </details>
          {fields.length > 0 && (
            <details open>
              <summary>{t("Qo'shimcha maydonlar")}</summary>
              <CustomFieldInputs fields={fields} values={v.extra} onChange={(extra) => setV({ ...v, extra })} users={users.data || []} variant="row" />
            </details>
          )}
        </div>

        <div className="card">
          {isNew ? (
            <div className="empty">{t("Kontragent saqlangandan keyin bu yerda hodisalar, hujjatlar va ko'rsatkichlar paydo bo'ladi.")}</div>
          ) : !card.data ? <Loading /> : (
            <>
              <div className="segmented" style={{ marginBottom: 14 }}>
                {[['events', t("Hodisalar")], ['docs', t("Hujjatlar")], ['stats', t("Ko'rsatkichlar")]].map(([k, l]) => (
                  <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t(l)}</button>
                ))}
              </div>
              {tab === 'events' && <Notes cpId={id} notes={card.data.notes} user={user} onAdded={() => setStamp((s) => s + 1)} />}
              {tab === 'docs' && <Documents card={card.data} />}
              {tab === 'stats' && (
                <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <Stat label={t('Bizga qarzi (debitor)')} bag={myDebt?.receivable} />
                  <Stat label={t('Bizning qarzimiz (kreditor)')} bag={myDebt?.payable} />
                  <Stat label={t('Buyurtmalar summasi')} bag={card.data.order_totals.amount} />
                  <Stat label={t('Buyurtmalar soni')} value={card.data.orders.length} sub={`${t('Sotuvlar')}: ${card.data.sales.length}`} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

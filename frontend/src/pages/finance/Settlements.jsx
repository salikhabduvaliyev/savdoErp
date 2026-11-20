// O'zaro hisob-kitoblar (MoySklad "Взаиморасчеты") va Korrektirovkalar ("Корректировки").
import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { DropMenu, usePager } from '../../components/Controls'
import { confirmDialog } from '../../components/Confirm'
import Icon, { IconBtn } from '../../components/Icon'
import { DateInput, NumInput } from '../../components/Inputs'
import PartyPicker from '../../components/PartyPicker'
import { Field, Loading, Modal, MoneyBag, toast, useFetch } from '../../components/ui'
import { CurrencyOptions, baseCurrency, curLabel } from '../../currency'
import { date, money } from '../../format'
import { t } from '../../i18n'

const iso = (d) => d.toISOString().slice(0, 10)
function periodOf(kind) {
  const now = new Date()
  const to = iso(now)
  if (kind === 'day') return { date_from: to, date_to: to }
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { date_from: iso(d), date_to: to } }
  if (kind === 'month') return { date_from: to.slice(0, 8) + '01', date_to: to }
  return { date_from: `${now.getFullYear()}-01-01`, date_to: to }
}
const Sum = ({ v, c }) => {
  const n = Number(v)
  return n ? <span className={n < 0 ? 'red' : ''}>{money(n, c)}</span> : <span className="muted">0</span>
}

/* ------------------------------------------------------------ Vzaimoraschyotlar */
export function Settlements() {
  const [f, setF] = useState(() => ({ ...periodOf('month'), group: '', currency: '', search: '', show_zero: false }))
  const [sel, setSel] = useState(null)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const groups = useFetch('/crm/groups/')
  const params = Object.fromEntries(Object.entries({ ...f, show_zero: f.show_zero ? 1 : '' }).filter(([, v]) => v !== '' && v != null))
  const { data, error } = useFetch('/finance/settlements/', params)
  const { rows, pager } = usePager(data?.rows, 50, JSON.stringify(f))
  return (
    <>
      <div className="filter-panel card">
        <div className="turn-filter">
          <label>{t('Davr')}
            <div className="period-links">
              {[['day', t('bugun')], ['week', t('hafta')], ['month', t('oy')], ['year', t('yil')]].map(([k, l], i) => (
                <span key={k}>{i > 0 && '·'}<button type="button" className="link-btn" onClick={() => setF((x) => ({ ...x, ...periodOf(k) }))}>{l}</button></span>
              ))}
            </div>
            <div className="inline-pick">
              <DateInput value={f.date_from} onChange={(e) => set('date_from', e.target.value)} />—
              <DateInput value={f.date_to} onChange={(e) => set('date_to', e.target.value)} />
            </div>
          </label>
          <label>{t('Kontragent guruhi')}
            <select value={f.group} onChange={(e) => set('group', e.target.value)}>
              <option value="">{t('Hammasi')}</option>
              {(groups.data?.results || groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label>{t('Valyuta')}
            <select value={f.currency} onChange={(e) => set('currency', e.target.value)}>
              <option value="">{t('Hammasi')}</option>
              <CurrencyOptions />
            </select>
          </label>
          <label>{t('Qidiruv')}<input value={f.search} placeholder={t('Kontragent nomi yoki telefon')} onChange={(e) => set('search', e.target.value)} /></label>
          <label className="check turn-moved"><input type="checkbox" checked={f.show_zero} onChange={(e) => set('show_zero', e.target.checked)} /> {t("Nol qoldiqlilarni ham ko'rsatish")}</label>
        </div>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Kontragent')}</th><th>{t('Valyuta')}</th><th className="num">{t("Boshlang'ich qoldiq")}</th><th className="num">{t('Kirim')}</th><th className="num">{t('Chiqim')}</th><th className="num">{t('Oxirgi qoldiq')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.counterparty}:${r.currency}`} className="clickable" onClick={() => setSel(r)}>
                  <td>{r.name}</td>
                  <td className="muted">{curLabel(r.currency)}</td>
                  <td className="num"><Sum v={r.opening} c={r.currency} /></td>
                  <td className="num green">{Number(r.income) ? money(r.income, r.currency) : <span className="muted">0</span>}</td>
                  <td className="num">{Number(r.outcome) ? money(r.outcome, r.currency) : <span className="muted">0</span>}</td>
                  <td className="num bold"><Sum v={r.closing} c={r.currency} /></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={6} className="empty">{t("Davrda hisob-kitob yo'q")}</td></tr>}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot><tr><td colSpan={2}>{t('Jami')}</td>
                <td className="num"><MoneyBag bag={data.totals.opening} /></td><td className="num"><MoneyBag bag={data.totals.income} /></td>
                <td className="num"><MoneyBag bag={data.totals.outcome} /></td><td className="num"><MoneyBag bag={data.totals.closing} /></td></tr></tfoot>
            )}
          </table>
          {pager}
          <p className="hint" style={{ padding: '0 12px 10px' }}>{t("Kirim — kontragentdan bizga (uning to'lovlari, yetkazgan tovari); chiqim — bizdan unga (sotuv, bizning to'lovlarimiz). Manfiy qoldiq — kontragent bizga qarzdor, musbat — biz unga qarzdormiz. Qatorni bosing — hujjatlar (akt-sverka).")}</p>
        </div>
      )}
      {sel && <Statement row={sel} period={f} onClose={() => setSel(null)} />}
    </>
  )
}

function Statement({ row, period, onClose }) {
  const { data, error } = useFetch('/finance/settlements/statement/', { counterparty: row.counterparty, currency: row.currency, date_from: period.date_from, date_to: period.date_to })
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const c = row.currency
  return (
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer turn-drawer">
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>{row.name}</h2>
            <div className="muted small">{t('Akt-sverka')} · {curLabel(c)} · {date(period.date_from)} — {date(period.date_to)}</div>
          </div>
          <button className="x" onClick={onClose} aria-label={t('Yopish')}><Icon name="close" size={18} /></button>
        </div>
        {!data ? <Loading error={error} /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Sana')}</th><th>{t('Hujjat')}</th><th className="num">{t('Kirim')}</th><th className="num">{t('Chiqim')}</th><th className="num">{t('Qoldiq')}</th></tr></thead>
              <tbody>
                <tr className="muted"><td>{date(period.date_from)}</td><td>{t("Boshlang'ich qoldiq")}</td><td /><td /><td className="num"><Sum v={data.opening[c] || 0} c={c} /></td></tr>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="small">{date(r.date)}</td>
                    <td>{t(r.label.split(' №')[0])}{r.label.includes(' №') ? ` №${r.label.split(' №')[1]}` : ''}</td>
                    <td className="num green">{Number(r.income) ? money(r.income, c) : ''}</td>
                    <td className="num">{Number(r.outcome) ? money(r.outcome, c) : ''}</td>
                    <td className="num bold"><Sum v={r.balance} c={c} /></td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={5} className="empty">{t("Davrda hujjat yo'q")}</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={4}>{t('Oxirgi qoldiq')}</td><td className="num"><Sum v={data.closing[c] || data.opening[c] || 0} c={c} /></td></tr></tfoot>
            </table>
          </div>
        )}
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------ Korrektirovkalar */
function AdjustmentForm({ item, kind, onClose, onSaved }) {
  const accounts = useFetch('/finance/accounts/')
  const cps = useFetch('/crm/counterparties/', { is_active: true })
  const groups = useFetch('/crm/groups/')
  const k = item?.kind || kind
  const [v, setV] = useState(() => ({
    date: item?.date || iso(new Date()), account: item?.account || '', counterparty: item?.counterparty ? String(item.counterparty) : '',
    currency: item?.currency || baseCurrency(), amount: item ? String(Number(item.amount)) : '', note: item?.note || '',
  }))
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key, val) => setV((x) => ({ ...x, [key]: val }))
  const acc = (accounts.data || []).find((a) => String(a.id) === String(v.account))
  const bal = useFetch(k === 'counterparty' && v.counterparty ? '/finance/settlements/balance/' : null, { counterparty: v.counterparty })
  const current = k === 'account' ? (acc ? Number(acc.balance) : null) : (bal.data ? Number(bal.data.balance[v.currency] || 0) : null)
  const cur = k === 'account' ? acc?.currency : v.currency
  const applyTarget = (val) => {
    setTarget(val)
    if (val !== '' && current !== null) set('amount', String(Math.round((Number(val) - current + (item ? Number(item.amount) : 0)) * 100) / 100))
  }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    const body = { kind: k, date: v.date, amount: v.amount, note: v.note,
      ...(k === 'account' ? { account: v.account } : { counterparty: v.counterparty, currency: v.currency }) }
    try {
      item ? await api.patch(`/finance/adjustments/${item.id}/`, body) : await api.post('/finance/adjustments/', body)
      onSaved()
    } catch (err) { toast(errorText(err), true) } finally { setBusy(false) }
  }
  return (
    <Modal dialog title={k === 'account' ? t("Korrektirovka: hisob qoldig'i") : t("Korrektirovka: o'zaro hisob-kitob")} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label={t('Sana')}><DateInput value={v.date} required onChange={(e) => set('date', e.target.value)} /></Field>
        {k === 'account' ? (
          <Field label={t('Hisob (kassa/bank)')}>
            <select value={v.account} required onChange={(e) => set('account', e.target.value)}>
              <option value="">{t('— tanlang —')}</option>
              {(accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balance, a.currency)}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label={t('Kontragent')}>
              <PartyPicker value={v.counterparty} onChange={(id) => set('counterparty', id)} placeholder={t('Kontragentni tanlang…')}
                counterparties={cps.data?.results || cps.data || []} groups={groups.data?.results || groups.data || []} />
            </Field>
            <Field label={t('Valyuta')}><select value={v.currency} onChange={(e) => set('currency', e.target.value)}><CurrencyOptions withName value={v.currency} /></select></Field>
          </>
        )}
        <Field label={t('Hozirgi qoldiq')}><input disabled value={current === null ? '—' : money(current, cur || baseCurrency())} /></Field>
        <Field label={t("Yangi qoldiq (ixtiyoriy — farq o'zi hisoblanadi)")}><NumInput allowNeg value={target} onChange={(e) => applyTarget(e.target.value)} /></Field>
        <Field label={t('Korrektirovka summasi (+ / −)')}><NumInput allowNeg value={v.amount} required onChange={(e) => { setTarget(''); set('amount', e.target.value) }} /></Field>
        <Field label={t('Izoh')} full><input value={v.note} onChange={(e) => set('note', e.target.value)} placeholder={t("Masalan: boshlang'ich qoldiqni kiritish, inventarizatsiya farqi…")} /></Field>
        <p className="hint full" style={{ margin: 0 }}>
          {k === 'account' ? t("+ hisob qoldig'ini oshiradi, − kamaytiradi.") : t("+ kontragent foydasiga (uning qarzi kamayadi / bizning qarzimiz oshadi), − uning qarzi oshadi.")}
        </p>
        <div className="full form-actions">
          <button type="button" className="btn" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary" disabled={busy || !Number(v.amount)}>{t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Adjustments() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [form, setForm] = useState(null)
  const [kind, setKind] = useState('')
  const { data, error } = useFetch('/finance/adjustments/', { stamp, kind: kind || undefined })
  const list = data?.results || data || []
  const { rows, pager } = usePager(data ? list : null, 50, kind)
  const remove = async (a) => {
    if (!(await confirmDialog(t("Korrektirovka №{n} o'chirilsinmi?", { n: a.number })))) return
    try { await api.delete(`/finance/adjustments/${a.id}/`); setStamp((x) => x + 1) } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="list-toolbar" style={{ marginBottom: 12 }}>
        {canCreate(user, 'finance') && (
          <DropMenu label={t('Korrektirovka')} icon="plus" items={[
            [t("Hisob (kassa/bank) qoldig'i"), () => setForm({ kind: 'account' })],
            [t("O'zaro hisob-kitob (kontragent)"), () => setForm({ kind: 'counterparty' })],
          ]} />
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 240 }}>
          <option value="">{t('Turi: hammasi')}</option>
          <option value="account">{t("Hisob qoldig'i")}</option>
          <option value="counterparty">{t("O'zaro hisob-kitob")}</option>
        </select>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>№</th><th>{t('Sana')}</th><th>{t('Turi')}</th><th>{t('Hisob / kontragent')}</th><th className="num">{t('Summa')}</th><th>{t('Izoh')}</th><th /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={canEdit(user, 'finance') ? 'clickable' : ''} onClick={() => canEdit(user, 'finance') && setForm({ item: a })}>
                  <td>{String(a.number).padStart(5, '0')}</td>
                  <td>{date(a.date)}</td>
                  <td className="small">{t(a.kind_display)}</td>
                  <td>{a.account_name || a.counterparty_name}</td>
                  <td className={'num bold ' + (Number(a.amount) < 0 ? 'red' : 'green')}>{Number(a.amount) > 0 ? '+' : ''}{money(a.amount, a.currency)}</td>
                  <td className="small muted">{a.note}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'finance') && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(a)} />}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="empty">{t("Korrektirovkalar yo'q")}</td></tr>}
            </tbody>
          </table>
          {pager}
        </div>
      )}
      {form && <AdjustmentForm item={form.item} kind={form.kind} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((x) => x + 1); toast(t('Saqlandi')) }} />}
    </>
  )
}

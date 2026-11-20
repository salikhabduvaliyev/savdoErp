import { useState } from 'react'
import api, { errorText } from '../../api'
import { Badge, Field, Loading, Modal, Stat, toast, useFetch } from '../../components/ui'
import { date } from '../../format'
import { t } from '../../i18n'
import { DateInput, NumInput } from '../../components/Inputs'
import { confirmDialog } from '../../components/Confirm'

const STATUS = [['trial', t("Sinov muddati")], ['active', t("Faol (to'langan)")], ['blocked', t("Bloklangan")]]

/* Kompaniya foydalanuvchilari: login, rol, holat; parolni tiklash (yangi parol bir marta ko'rsatiladi) */
function CompanyUsers({ company }) {
  const { data, error, reload } = useFetch(`/auth/platform/companies/${company.id}/users/`)
  const [shown, setShown] = useState(null)
  const [reveal, setReveal] = useState({})
  const copy = (txt) => { navigator.clipboard?.writeText(txt).then(() => toast(t('Nusxalandi')), () => {}) }
  const reset = async (u) => {
    if (!(await confirmDialog(t('«{u}» uchun yangi parol yaratilsinmi?\nEski parol ishlamay qoladi.', { u: u.username }), { okText: t('Yangi parol') }))) return
    try {
      const { data: r } = await api.post(`/auth/platform/companies/${company.id}/reset_password/`, { user: u.id })
      setShown(r)
      reload()
    } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{t('Login')}</th><th>{t('Parol')}</th><th>{t('Ism')}</th><th>{t('Rol')}</th><th>{t('Telefon')}</th><th>{t('Oxirgi kirish')}</th><th>{t('Holat')}</th><th /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td><b className="mono">{u.username}</b> <button type="button" className="link-btn small" onClick={() => copy(u.username)}>{t('nusxa')}</button></td>
                <td>
                  {u.password ? (
                    <span className="pw-cell">
                      <b className="mono">{reveal[u.id] ? u.password : '••••••••'}</b>
                      <button type="button" className="link-btn small" onClick={() => setReveal((r) => ({ ...r, [u.id]: !r[u.id] }))}>{reveal[u.id] ? t('yashirish') : t("ko'rsatish")}</button>
                      <button type="button" className="link-btn small" onClick={() => copy(u.password)}>{t('nusxa')}</button>
                    </span>
                  ) : <span className="muted small" title={t("Parol foydalanuvchi keyingi kirishida yoki tiklanganda saqlanadi")}>{t("hali ma'lum emas")}</span>}
                </td>
                <td>{u.full_name}</td>
                <td className="small">{t(u.role || '—')}</td>
                <td className="small">{u.phone || '—'}</td>
                <td className="small">{u.last_login ? date(u.last_login) : <span className="muted">{t('hech qachon')}</span>}</td>
                <td><Badge kind={u.is_active ? 'ok' : 'low'}>{u.is_active ? t('Faol') : t('Bloklangan')}</Badge></td>
                <td className="num"><button type="button" className="btn small" onClick={() => reset(u)}>{t('Parolni tiklash')}</button></td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={8} className="empty">{t("Foydalanuvchilar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">{t("Parollar bazada shifrlangan holda saqlanadi va faqat platforma adminiga ko'rinadi. Eski foydalanuvchining paroli u keyingi marta tizimga kirganda yoki parol tiklanganda paydo bo'ladi. Har bir ko'rish tarixga yoziladi.")}</p>
      {shown && (
        <Modal dialog title={t('Yangi parol')} onClose={() => setShown(null)}>
          <dl className="kv">
            <dt>{t('Login')}</dt><dd><b className="mono">{shown.username}</b></dd>
            <dt>{t('Parol')}</dt><dd><b className="mono pw-big">{shown.password}</b></dd>
          </dl>
          <p className="muted small">{t("Parol foydalanuvchilar ro'yxatida ham saqlanadi — nusxalab, mijozga yuboring.")}</p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => copy(`${shown.username} / ${shown.password}`)}>{t('Nusxalash')}</button>
            <button type="button" className="btn primary" onClick={() => setShown(null)}>{t('Yopish')}</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Manage({ c, onClose, onSaved }) {
  const [v, setV] = useState({ status: c.status, trial_ends: c.trial_ends || '', paid_until: c.paid_until || '',
    max_users: c.max_users, platform_note: c.platform_note })
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState('sub')
  const [error, setError] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    try {
      await api.patch(`/auth/platform/companies/${c.id}/`, { ...v, trial_ends: v.trial_ends || null, paid_until: v.paid_until || null })
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  const extend = async () => {
    try {
      await api.post(`/auth/platform/companies/${c.id}/extend/`, { days })
      toast(`Obuna ${days} kunga uzaytirildi`)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={c.name} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>{t("Egasi")}</dt><dd>{c.owner ? `${c.owner.full_name} (${c.owner.username}) · ${c.owner.phone || '—'}` : '—'}</dd>
        <dt>{t("Ro'yxatdan o'tgan")}</dt><dd>{date(c.created_at)}</dd>
        <dt>{t("Foydalanuvchilar / filiallar")}</dt><dd>{c.users_count} / {c.branches_count}</dd>
      </dl>
      <div className="tabs">
        <button type="button" className={'btn' + (tab === 'sub' ? ' active' : '')} onClick={() => setTab('sub')}>{t('Obuna')}</button>
        <button type="button" className={'btn' + (tab === 'users' ? ' active' : '')} onClick={() => setTab('users')}>{t('Foydalanuvchilar')} ({c.users_count})</button>
      </div>
      {tab === 'users' && <CompanyUsers company={c} />}
      {tab === 'sub' && <>
      <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 14 }}>
        <div className="filters">
          <b>{t("Tezkor uzaytirish:")}</b>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} type="button" className={'chip' + (days === d ? ' on' : '')} onClick={() => setDays(d)}>{d} kun</button>
          ))}
          <button type="button" className="btn primary small" onClick={extend}>{t("Uzaytirish")}</button>
        </div>
      </div>
      <form className="form" onSubmit={save}>
        <Field label={t("Holat")}>
          <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t("Foydalanuvchilar chegarasi (0 — cheklanmagan)")}><NumInput min="0" value={v.max_users} onChange={(e) => setV({ ...v, max_users: e.target.value })} /></Field>
        <Field label={t("Sinov tugash sanasi")}><DateInput value={v.trial_ends} onChange={(e) => setV({ ...v, trial_ends: e.target.value })} /></Field>
        <Field label={t("To'langan muddat (gacha)")}><DateInput value={v.paid_until} onChange={(e) => setV({ ...v, paid_until: e.target.value })} /></Field>
        <Field label={t("Izoh")} full><textarea rows={2} value={v.platform_note} onChange={(e) => setV({ ...v, platform_note: e.target.value })} /></Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Yopish")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
      </>}
    </Modal>
  )
}

export default function PlatformPage() {
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ search: '', status: '' })
  const params = Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/auth/platform/companies/', params)
  const [sel, setSel] = useState(null)
  const rows = data || []
  const count = (st) => rows.filter((c) => c.status === st).length
  const expiring = rows.filter((c) => c.status !== 'blocked' && c.days_left >= 0 && c.days_left <= 7).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Kompaniyalar")}</h1>
          <div className="page-sub">{t("Ro'yxatdan o'tgan mijoz-kompaniyalar va obuna muddatlari")}</div>
        </div>
      </div>
      <div className="stats">
        <Stat label={t("Jami kompaniyalar")} value={rows.length} />
        <Stat label={t("Sinov muddatida")} value={count('trial')} />
        <Stat label={t("To'lagan (faol)")} value={count('active')} valueClass="green" />
        <Stat label={t("7 kun ichida tugaydi")} value={expiring} valueClass={expiring ? 'red' : ''} />
      </div>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          <input placeholder={t("Nomi, telefon, STIR…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">{t("Holat: hammasi")}</option>
            {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>{t("Kompaniya")}</th><th>{t("Egasi")}</th><th>{t("Ro'yxatdan o'tgan")}</th><th>{t("Holat")}</th><th>{t("Muddat")}</th><th className="num">{t("Qoldi")}</th><th className="num">{t("Foyd.")}</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setSel(c)}>
                  <td><div className="bold">{c.name}</div><div className="small muted">{c.phone}</div></td>
                  <td>{c.owner ? <>{c.owner.full_name}<div className="small muted">{c.owner.username}</div></> : '—'}</td>
                  <td>{date(c.created_at)}</td>
                  <td><Badge kind={c.is_accessible ? c.status : 'low'}>{c.is_accessible ? c.status_display : (c.status === 'blocked' ? 'Bloklangan' : 'Muddati tugagan')}</Badge></td>
                  <td>{date(c.access_until)}</td>
                  <td className={'num ' + (c.days_left <= 3 ? 'red bold' : '')}>{c.access_until ? t('{n} kun', { n: c.days_left }) : '—'}</td>
                  <td className="num">{c.users_count}{c.max_users ? ` / ${c.max_users}` : ''}</td>
                  <td className="num"><span className="link-btn">{t("Boshqarish")}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">{t("Kompaniyalar yo'q")}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {sel && <Manage c={sel} onClose={() => setSel(null)} onSaved={() => { setSel(null); setStamp((s) => s + 1); toast('Saqlandi') }} />}
    </>
  )
}

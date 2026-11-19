// Sozlamalar → Valyutalar (MoySklad "Валюты"): ma'lumotnoma, kurs qo'lda yoki CBU'dan avtomatik
import { Fragment, useState } from 'react'
import api, { errorText } from '../../api'
import { loadCurrencies } from '../../currency'
import Icon, { IconBtn } from '../../components/Icon'
import { Badge, Field, Loading, Modal, toast, useFetch } from '../../components/ui'
import { date, num, todayISO } from '../../format'
import { t } from '../../i18n'
import { confirmDialog } from '../../components/Confirm'
import { DateInput, NumInput } from '../../components/Inputs'

function CurrencyForm({ item, onClose, onSaved }) {
  const cbu = useFetch(item ? null : '/core/currencies/cbu/')
  const [v, setV] = useState(item || { code: '', name: '', symbol: '', auto_update: true, is_active: true })
  const [error, setError] = useState(null)
  const pickCbu = (code) => {
    const c = (Array.isArray(cbu.data) ? cbu.data : []).find((x) => x.code === code)
    setV((s) => ({ ...s, code, name: c?.name || s.name, auto_update: !!c }))
  }
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = item ? await api.patch(`/core/currencies/${item.id}/`, v) : await api.post('/core/currencies/', v)
      if (!item && v.auto_update) await api.post('/core/currencies/refresh/', { codes: [data.code] }).catch(() => {})
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  const cbuList = Array.isArray(cbu.data) ? cbu.data : []
  return (
    <Modal title={item ? `${item.code} — ${item.name}` : t('Yangi valyuta')} onClose={onClose} dialog>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        {!item && (
          <Field label="CBU ro'yxatidan tanlash" full>
            <select value={cbuList.some((c) => c.code === v.code) ? v.code : ''} onChange={(e) => pickCbu(e.target.value)}>
              <option value="">{cbu.data ? t('— tanlang yoki pastda qo\'lda kiriting —') : cbu.error ? t("CBU bilan aloqa yo'q — qo'lda kiriting") : t('Yuklanmoqda…')}</option>
              {cbuList.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name} ({num(c.rate, 2)} {t("so'm")})</option>)}
            </select>
          </Field>
        )}
        <Field label="Kod (ISO)"><input value={v.code} maxLength={3} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} required disabled={item?.is_base || item?.code === 'UZS'} placeholder="EUR" /></Field>
        <Field label="Belgi"><input value={v.symbol} maxLength={8} onChange={(e) => setV({ ...v, symbol: e.target.value })} placeholder="€" /></Field>
        <Field label="Nomi" full><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
        {item?.code !== 'UZS' && (
          <div className="full">
            <label className="check"><input type="checkbox" checked={v.auto_update} onChange={(e) => setV({ ...v, auto_update: e.target.checked })} /> {t("Kursni CBU'dan avtomatik olish (har kuni)")}</label>
            <label className="check"><input type="checkbox" checked={v.is_active} disabled={item?.is_base} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> {t('Faol (hujjatlarda tanlanadi)')}</label>
          </div>
        )}
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary"><Icon name="save" size={16} /> {t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

function RateHistory({ cur, editable, onChanged }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/core/rates/', { currency: cur.code, stamp })
  const [v, setV] = useState({ date: todayISO(), rate: '' })
  const [edit, setEdit] = useState(null)
  const reload = () => { setStamp((s) => s + 1); onChanged() }
  const add = async () => {
    try {
      await api.post('/core/rates/', { currency: cur.code, date: v.date, rate: v.rate })
      toast(t('Kurs saqlandi'))
      setV({ ...v, rate: '' })
      reload()
    } catch (e) { toast(errorText(e), true) }
  }
  const saveEdit = async () => {
    try { await api.patch(`/core/rates/${edit.id}/`, { rate: edit.rate, source: "qo'lda" }); setEdit(null); reload() } catch (e) { toast(errorText(e), true) }
  }
  const remove = async (r) => {
    if (!await confirmDialog(t("O'chirilsinmi?"))) return
    try { await api.delete(`/core/rates/${r.id}/`); reload() } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className="rate-history">
      {editable && (
        <div className="table-toolbar filters">
          <DateInput value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          <NumInput step="any" min="0" placeholder={t('1 {c} = … so\'m', { c: cur.code })} value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
          <button className="btn small primary" disabled={!v.rate} onClick={add}><Icon name="plus" size={15} /> {t("Kursni qo'lda kiritish")}</button>
        </div>
      )}
      {!data ? <Loading error={error} /> : (
        <table className="t compact">
          <thead><tr><th>{t('Sana')}</th><th className="num">1 {cur.code}</th><th>{t('Manba')}</th><th /></tr></thead>
          <tbody>
            {data.slice(0, 40).map((r) => (
              <tr key={r.id}>
                <td>{date(r.date)}</td>
                <td className="num">
                  {edit?.id === r.id
                    ? <input className="cell" autoFocus value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} style={{ width: 120 }} />
                    : <>{num(r.rate, 2)} {t("so'm")}</>}
                </td>
                <td><Badge kind={r.source === 'CBU' ? 'confirmed' : 'draft'}>{r.source}</Badge></td>
                <td className="num">
                  {editable && (edit?.id === r.id
                    ? <><IconBtn icon="check" title="Saqlash" onClick={saveEdit} /><IconBtn icon="close" title="Bekor" onClick={() => setEdit(null)} /></>
                    : <><IconBtn icon="edit" title="Kursni tuzatish" onClick={() => setEdit({ id: r.id, rate: r.rate })} /><IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(r)} /></>)}
                </td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={4} className="empty">{t("Kurs kiritilmagan")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Currencies({ editable }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/core/currencies/', { stamp })
  const [form, setForm] = useState(null)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const reload = () => { setStamp((s) => s + 1); loadCurrencies(true) }
  const refresh = async () => {
    setBusy(true)
    try {
      const { data: r } = await api.post('/core/currencies/refresh/', {})
      if (r.errors?.length) toast(r.errors.join('; '), true)
      else toast(t('Yangilandi: {n} ta valyuta', { n: r.updated.length }))
      reload()
    } catch (e) { toast(errorText(e), true) } finally { setBusy(false) }
  }
  const makeBase = async (code) => {
    const c = (data || []).find((x) => x.code === code)
    if (!c || c.is_base) return
    if (!await confirmDialog(t("Asosiy valyuta {c} qilinsinmi?\nHisobotlar va yangi hujjatlar shu valyutada bo'ladi. Mavjud hujjatlar o'zgarmaydi.", { c: `${c.code} — ${t(c.name)}` }))) return
    try { await api.post(`/core/currencies/${c.id}/make_base/`); toast(t('Asosiy valyuta: {c}', { c: c.code })); reload() } catch (e) { toast(errorText(e), true) }
  }
  const base = (data || []).find((c) => c.is_base)
  const remove = async (c) => {
    if (!await confirmDialog(t("O'chirilsinmi?") + `\n${c.code}`)) return
    try { await api.delete(`/core/currencies/${c.id}/`); reload() } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Valyutalar')}</h1>
          <div className="page-sub">{t("Kurs: 1 birlik = necha so'm (CBU). Hujjatda operatsiya sanasidagi (yoki undan oldingi eng yaqin) kurs ishlatiladi.")}</div>
        </div>
        <span className="grow" />
        {editable && <button className="btn" onClick={refresh} disabled={busy}><Icon name="refresh" size={16} /> {t("CBU'dan yangilash")}</button>}
        {editable && <button className="btn primary" onClick={() => setForm({ item: null })}><Icon name="plus" size={16} /> {t('Valyuta')}</button>}
      </div>
      {data && (
        <div className="card base-cur">
          <div>
            <div className="base-cur-label">{t('Asosiy (hisob) valyuta')}</div>
            <div className="muted small">{t("Hisobotlar (foyda va zarar, foydalilik, dashboard) va yangi hujjatlar shu valyutada. Boshqa valyutalar kurs bo'yicha qayta hisoblanadi.")}</div>
          </div>
          <select value={base?.code || 'UZS'} disabled={!editable} onChange={(e) => makeBase(e.target.value)}>
            {data.filter((c) => c.is_active || c.is_base).map((c) => <option key={c.code} value={c.code}>{c.code} — {t(c.name)}</option>)}
          </select>
        </div>
      )}
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Kod')}</th><th>{t('Nomi')}</th><th>{t('Belgi')}</th><th className="num">{t('Kurs')}</th><th>{t('Sana')}</th><th>{t('Kurs manbai')}</th><th>{t('Holat')}</th><th /></tr></thead>
            <tbody>
              {data.map((c) => (
                <Fragment key={c.id}>
                  <tr className={c.code === 'UZS' ? '' : 'clickable'} onClick={() => c.code !== 'UZS' && setOpen(open === c.id ? null : c.id)}>
                    <td className="bold">{c.code !== 'UZS' && <Icon name={open === c.id ? 'chevron-down' : 'chevron-right'} size={14} />} {c.code}</td>
                    <td>{t(c.name)}{c.is_base && <Badge kind="confirmed">{t('asosiy')}</Badge>}</td>
                    <td>{c.symbol}</td>
                    <td className="num bold">
                      {c.code === 'UZS' ? '1' : c.rate ? `${num(c.rate, 2)} ${t("so'm")}` : <span className="red">{t('kiritilmagan')}</span>}
                      {c.base_rate && <div className="small muted">= {num(c.base_rate, 4)} {base?.code}</div>}
                    </td>
                    <td className="small">{c.rate_date ? date(c.rate_date) : '—'}</td>
                    <td className="small">{c.code === 'UZS' ? '—' : c.auto_update ? <Badge kind="confirmed">{t('CBU avtomatik')}</Badge> : <Badge kind="draft">{t("qo'lda")}</Badge>}</td>
                    <td>{c.is_active ? <Badge kind="ok">{t('Faol')}</Badge> : <Badge kind="low">{t('Nofaol')}</Badge>}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      {editable && !c.is_base && c.is_active && <IconBtn icon="check" title="Asosiy qilish" onClick={() => makeBase(c.code)} />}
                      {editable && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: c })} />}
                      {editable && !c.is_base && !['UZS', 'USD'].includes(c.code) && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(c)} />}
                    </td>
                  </tr>
                  {open === c.id && (
                    <tr><td colSpan={8} style={{ background: 'var(--surface-2)' }}><RateHistory cur={c} editable={editable} onChanged={reload} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{t("Qatorni bosing — kurslar tarixi. Kursni qo'lda tuzatsangiz, manba \"qo'lda\" bo'ladi va CBU uni almashtirmaydi.")}</p>
      {form && <CurrencyForm item={form.item} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); toast(t('Saqlandi')) }} />}
    </>
  )
}

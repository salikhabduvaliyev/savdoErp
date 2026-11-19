import { useState } from 'react'
import api, { errorText } from '../api'
import { t } from '../i18n'
import { date, num } from '../format'
import { Badge, Field, Loading, Modal, toast, useFetch } from './ui'
import { IconBtn } from './Icon'
import { confirmDialog } from './Confirm'
import { DateInput, NumInput } from './Inputs'

export const FIELD_TYPES = [
  ['text', t("Matn")], ['number', t("Son")], ['date', t("Sana")], ['bool', t("Ha/Yo'q")], ['select', t("Ro'yxatdan tanlash")], ['user', t("Xodim")],
]
const ENTITY_LABEL = { order: 'Buyurtma', counterparty: 'Kontragent', sale: 'Sotuv' }

// eslint-disable-next-line react-refresh/only-export-components
export function useCustomFields(entity, stamp = 0) {
  const { data } = useFetch(entity ? '/core/custom-fields/' : null, { entity, stamp })
  return data || []
}

/** Ro'yxatda ko'rsatish uchun qiymat */
// eslint-disable-next-line react-refresh/only-export-components
export function formatExtra(field, value, users = []) {
  if (value === undefined || value === null || value === '') return <span className="muted">—</span>
  switch (field.type) {
    case 'bool': return value ? t('Ha') : t("Yo'q")
    case 'date': return date(value)
    case 'number': return num(value, String(value).includes('.') ? 2 : 0)
    case 'user': return users.find((u) => String(u.id) === String(value))?.full_name || '—'
    default: return String(value)
  }
}

function Input({ f, value, onChange, users, compact }) {
  const cls = compact ? undefined : undefined
  switch (f.type) {
    case 'bool':
      return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {t('Ha')}</label>
    case 'number':
      return <NumInput className={cls} step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required} />
    case 'date':
      return <DateInput className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required} />
    case 'select':
      return (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required}>
          <option value="">—</option>
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'user':
      return (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required}>
          <option value="">—</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      )
    default:
      return <input className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required} />
  }
}

/** Forma ichida qo'shimcha maydonlar (Field yoki "row" ko'rinishida) */
export function CustomFieldInputs({ fields, values, onChange, users = [], variant = 'field' }) {
  if (!fields.length) return null
  const set = (key, v) => onChange({ ...(values || {}), [key]: v })
  return fields.map((f) => (variant === 'row' ? (
    <div className="row" key={f.id}>
      <label>{f.name}{f.required && ' *'}</label>
      <Input f={f} value={values?.[f.key]} onChange={(v) => set(f.key, v)} users={users} />
    </div>
  ) : (
    <Field key={f.id} label={f.name + (f.required ? ' *' : '')}>
      <Input f={f} value={values?.[f.key]} onChange={(v) => set(f.key, v)} users={users} />
    </Field>
  )))
}

/** Ro'yxat filtri uchun maydon (x_<key>) */
export function CustomFieldFilter({ f, value, onChange, users = [] }) {
  if (f.type === 'select') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.name}: {t('hammasi')}</option>
        {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (f.type === 'user') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.name}: {t('hammasi')}</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
    )
  }
  if (f.type === 'bool') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.name}</option><option value="true">{t('Ha')}</option><option value="false">{t("Yo'q")}</option>
      </select>
    )
  }
  return <input placeholder={f.name} value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ width: 140 }} />
}

/* ---------------------------------------------------------------- boshqaruv */
function FieldForm({ entity, item, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    name: item?.name || '', type: item?.type || 'text', options: (item?.options || []).join('\n'),
    required: item?.required || false, show_in_list: item?.show_in_list ?? true, filterable: item?.filterable ?? true,
    position: item?.position ?? 0,
  }))
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...v, entity, options: v.type === 'select' ? v.options.split('\n').map((x) => x.trim()).filter(Boolean) : [] }
    try {
      item ? await api.patch(`/core/custom-fields/${item.id}/`, payload) : await api.post('/core/custom-fields/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={item ? item.name : t("Yangi qo'shimcha maydon")} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label={t('Nomi')} full><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required autoFocus /></Field>
        <Field label={t('Turi')}>
          <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} disabled={!!item}>
            {FIELD_TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </Field>
        <Field label={t('Tartib')}><NumInput value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} /></Field>
        {v.type === 'select' && (
          <Field label={t('Variantlar (har biri yangi qatorda)')} full>
            <textarea rows={4} value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} placeholder={'PVX\nTermo\nAlyumin'} />
          </Field>
        )}
        <label className="check full"><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} /> {t("Majburiy maydon")}</label>
        <label className="check full"><input type="checkbox" checked={v.show_in_list} onChange={(e) => setV({ ...v, show_in_list: e.target.checked })} /> {t("Ro'yxatda ustun sifatida ko'rsatish")}</label>
        <label className="check full"><input type="checkbox" checked={v.filterable} onChange={(e) => setV({ ...v, filterable: e.target.checked })} /> {t('Filtrda ishlatish')}</label>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary">{t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function CustomFieldsManager({ entity, editable = true, embedded = false, onChanged }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/core/custom-fields/', { entity, stamp })
  const [form, setForm] = useState(null)
  const refresh = () => { setStamp((s) => s + 1); onChanged?.() }
  const remove = async (f) => {
    if (!await confirmDialog(t('"{n}" maydoni o\'chirilsinmi? Kiritilgan qiymatlar ko\'rinmay qoladi.', { n: f.name }))) return
    try { await api.delete(`/core/custom-fields/${f.id}/`); refresh() } catch (e) { toast(errorText(e), true) }
  }
  const body = !data ? <Loading error={error} /> : (
    <div className="table-wrap" style={embedded ? undefined : { boxShadow: 'none' }}>
      <div className="table-toolbar">
        <b>{t(ENTITY_LABEL[entity])}: {t("qo'shimcha maydonlar")}</b><span style={{ flex: 1 }} />
        {editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>+ {t('Maydon')}</button>}
      </div>
      <table className="t">
        <thead><tr><th>{t('Nomi')}</th><th>{t('Turi')}</th><th>{t('Variantlar')}</th><th>{t('Belgilar')}</th><th /></tr></thead>
        <tbody>
          {data.map((f) => (
            <tr key={f.id}>
              <td className="bold">{f.name}</td>
              <td>{t(f.type_display)}</td>
              <td className="small muted">{(f.options || []).join(', ') || '—'}</td>
              <td>
                {f.required && <Badge kind="low">{t('majburiy')}</Badge>}{' '}
                {f.show_in_list && <Badge kind="draft">{t("ro'yxatda")}</Badge>}{' '}
                {f.filterable && <Badge kind="neutral">{t('filtr')}</Badge>}
              </td>
              <td className="num">{editable && <>
                <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: f })} />{' '}
                <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(f)} />
              </>}</td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={5} className="empty">{t("Qo'shimcha maydonlar yo'q")}</td></tr>}
        </tbody>
      </table>
      {form && <FieldForm entity={entity} item={form.item} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); toast(t('Saqlandi')) }} />}
    </div>
  )
  return body
}

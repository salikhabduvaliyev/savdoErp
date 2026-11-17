import { useState } from 'react'
import api, { errorText } from '../api'
import { Field, FullPage, Modal, toast } from './ui'
import Icon from './Icon'
import { t } from '../i18n'

/**
 * Oddiy CRUD forma.
 * fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'textarea'|'checkbox'|'password'|'email', options: [[v,l]], full, required, section }]
 */
export default function EntityForm({ title, url, item, fields, defaults = {}, onClose, onSaved, wide, extra, dialog, deletable = true }) {
  const [values, setValues] = useState(() => {
    const v = { ...defaults, ...(item || {}) }
    fields.forEach((f) => { if (v[f.name] === undefined || v[f.name] === null) v[f.name] = f.type === 'checkbox' ? false : '' })
    return v
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (name, value) => setValues((s) => ({ ...s, [name]: value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = {}
    fields.forEach((f) => {
      if (f.readOnly) return
      let v = values[f.name]
      if (v === '' && (f.type === 'select' || f.type === 'date' || f.type === 'number' || f.nullable)) v = null
      payload[f.name] = v
    })
    try {
      const { data } = item?.id ? await api.patch(`${url}${item.id}/`, payload) : await api.post(url, payload)
      onSaved(data)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t("O'chirilsinmi?") + (title ? `
${t(title)}` : ''))) return
    setBusy(true)
    try {
      await api.delete(`${url}${item.id}/`)
      toast(t("O'chirildi"))
      onSaved(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  let lastSection = null
  return (
    <Modal title={title} onClose={onClose} wide={wide} dialog={dialog}>
      {error && <div className="error">{error}</div>}
      <form className={'form' + (wide ? ' three' : '')} onSubmit={submit}>
        {fields.map((f) => {
          const header = f.section && f.section !== lastSection ? <div key={'s-' + f.section} className="full section-title">{f.section}</div> : null
          lastSection = f.section || lastSection
          const common = { disabled: f.readOnly, required: f.required }
          let input
          if (f.type === 'select') {
            input = (
              <select value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} {...common}>
                {!f.noEmpty && <option value="">{t("— tanlang —")}</option>}
                {(f.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )
          } else if (f.type === 'textarea') {
            input = <textarea rows={2} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} {...common} />
          } else if (f.type === 'checkbox') {
            return (
              <div key={f.name} className={f.full ? 'full' : ''}>
                {header}
                <label className="check" style={{ marginTop: f.full ? 0 : 22 }}>
                  <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} disabled={f.readOnly} />
                  {f.label}
                </label>
              </div>
            )
          } else {
            input = (
              <input type={f.type || 'text'} step={f.step || (f.type === 'number' ? 'any' : undefined)} value={values[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} {...common} />
            )
          }
          return [header, <Field key={f.name} label={f.label} full={f.full}>{input}</Field>]
        })}
        {extra}
        <div className="full form-actions">
          {deletable && item?.id && <button type="button" className="btn danger-ghost" onClick={remove} disabled={busy} title={t("O'chirish")}><Icon name="delete" size={16} /> {t("O'chirish")}</button>}
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary" disabled={busy}><Icon name="save" size={16} /> {busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Drawer({ onClose, children }) {
  // hujjat kartochkasi — endi to'liq sahifa (sarlavha ichidagi kontentda)
  return <FullPage onClose={onClose} wide bare>{children}</FullPage>
}

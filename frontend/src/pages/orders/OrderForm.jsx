import { useState } from 'react'
import api, { errorText } from '../../api'
import { CustomFieldInputs, useCustomFields } from '../../components/CustomFields'
import { Field, Modal, useForm } from '../../components/ui'
import { todayISO } from '../../format'
import { t } from '../../i18n'

export default function OrderForm({ refs, order, fields: fieldsProp, onClose, onSaved }) {
  const loaded = useCustomFields(fieldsProp ? null : 'order')
  const fields = fieldsProp || loaded
  const { values, bind, setValues } = useForm(
    order || { date: todayISO(), currency: 'UZS', amount: '', volume: '0', plan_date: '', production_date: '', client: '', note: '', extra: {} },
  )
  const [newClient, setNewClient] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let client = values.client
      if (!client && newClient.trim()) {
        const { data } = await api.post('/crm/counterparties/', { name: newClient.trim(), is_client: true })
        client = data.id
        refs.reloadClients?.()
      }
      const payload = { ...values, client, production_date: values.production_date || null, operator: values.operator || null, manager: values.manager || null }
      const { data } = order ? await api.patch(`/orders/${order.id}/`, payload) : await api.post('/orders/', payload)
      onSaved(data)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const operators = refs.users
  const managers = refs.users

  return (
    <Modal title={order ? `Buyurtma ${order.number}` : 'Yangi buyurtma'} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label={t("Mijoz")} full>
          <div style={{ display: 'flex', gap: 8 }}>
            <select {...bind('client')} style={{ flex: 1 }}>
              <option value="">{t("— tanlang —")}</option>
              {refs.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!values.client && (
              <input placeholder={t("yoki yangi mijoz nomi")} value={newClient} onChange={(e) => setNewClient(e.target.value)} style={{ flex: 1 }} />
            )}
          </div>
        </Field>
        <Field label={t("Sana")}><input type="date" {...bind('date')} required /></Field>
        <Field label={t("Valyuta")}>
          <select {...bind('currency')} disabled={!!order}>
            <option value="UZS">{t("so'm")}</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label={`Summa (${values.currency === 'USD' ? 'USD' : "so'm"})`}>
          <input type="number" step="0.01" min="0" {...bind('amount')} required />
        </Field>
        <Field label={t("Hajm, m² (yuklama uchun)")}><input type="number" step="0.001" min="0" {...bind('volume')} /></Field>
        <Field label={t("Mijozga topshirish muddati (reja sana)")}><input type="date" {...bind('plan_date')} required /></Field>
        <Field label={t("Ishlab chiqarish kuni (kalendar)")}><input type="date" {...bind('production_date')} /></Field>
        <Field label={t("Menejer")}>
          <select {...bind('manager')}>
            <option value="">{t("— men —")}</option>
            {managers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label={t("Operator")}>
          <select {...bind('operator')}>
            <option value="">—</option>
            {operators.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label={t("Izoh")} full><textarea rows={2} {...bind('note')} /></Field>
        {fields.length > 0 && <div className="full section-title">{t("Qo'shimcha maydonlar")}</div>}
        <CustomFieldInputs fields={fields} values={values.extra || {}} onChange={(extra) => setValues((v) => ({ ...v, extra }))} users={refs.users} />
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary" disabled={busy || (!values.client && !newClient.trim())}>
            {busy ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

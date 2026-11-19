import { useState } from 'react'
import api, { errorText } from '../../api'
import { Field, Modal, useFetch, useForm } from '../../components/ui'
import { money, todayISO } from '../../format'
import { t } from '../../i18n'
import { curLabel } from '../../currency'
import { SearchSelect } from '../../components/Controls'

const KINDS = [
  ['client_payment', t("Mijoz to'lovi (kirim)")],
  ['other_income', t("Boshqa kirim")],
  ['expense', t("Xarajat (chiqim)")],
  ['supplier_payment', t("Yetkazuvchiga to'lov")],
  ['salary', t("Ish haqi")],
]

export default function TransactionForm({ kind = 'client_payment', order, onClose, onSaved }) {
  const { values, bind } = useForm({
    date: todayISO(), kind, account: '', amount: '', order: order?.id || '', client: order?.client || '',
    supplier: '', category: '', description: '', order_amount: '',
  })
  const [error, setError] = useState(null)
  const accounts = useFetch('/finance/accounts/')
  const categories = useFetch('/finance/categories/')
  const suppliers = useFetch('/crm/counterparties/', { role: 'supplier', is_active: true })
  const clients = useFetch('/crm/counterparties/', { role: 'client', is_active: true })
  const orders = useFetch(order ? null : '/orders/', { status: 'new,confirmed,in_production,ready,delivered' })

  const account = (accounts.data || []).find((a) => String(a.id) === String(values.account))
  const selOrder = order || (orders.data?.results || []).find((o) => String(o.id) === String(values.order))
  const crossCurrency = account && selOrder && account.currency !== selOrder.currency
  const k = values.kind

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const payload = { ...values }
    for (const key of ['order', 'client', 'supplier', 'category', 'order_amount']) if (!payload[key]) payload[key] = null
    if (k !== 'client_payment') payload.client = null
    if (k !== 'supplier_payment') payload.supplier = null
    if (k === 'supplier_payment' || k === 'salary') payload.order = null
    try {
      await api.post('/finance/transactions/', payload)
      onSaved()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title={order ? `Buyurtma ${order.number}: ${KINDS.find((x) => x[0] === k)?.[1]}` : 'Yangi pul harakati'} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        {!order && (
          <Field label={t("Turi")} full>
            <select {...bind('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
        )}
        <Field label={t("Sana")}><input type="date" {...bind('date')} required /></Field>
        <Field label={t("Hisob (kassa/bank)")}>
          <select {...bind('account')} required>
            <option value="">{t("— tanlang —")}</option>
            {(accounts.data || []).filter((a) => a.is_active).map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {money(a.balance, a.currency)}</option>
            ))}
          </select>
        </Field>
        <Field label={`Summa${account ? ` (${curLabel(account.currency)})` : ''}`}>
          <input type="number" step="0.01" min="0" {...bind('amount')} required />
        </Field>
        {k === 'expense' && (
          <Field label={t("Xarajat turi")}>
            <select {...bind('category')} required>
              <option value="">{t("— tanlang —")}</option>
              {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.affects_profit ? '' : " (foydaga ta'sir qilmaydi)"}</option>)}
            </select>
          </Field>
        )}
        {k === 'supplier_payment' && (
          <Field label={t("Yetkazuvchi")}>
            <SearchSelect value={values.supplier || ''} onChange={(id) => bind('supplier').onChange({ target: { value: id } })}
              options={(suppliers.data || []).map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        {!order && ['client_payment', 'expense'].includes(k) && (
          <Field label={t("Buyurtma (ixtiyoriy)")}>
            <SearchSelect value={values.order || ''} onChange={(id) => bind('order').onChange({ target: { value: id } })} empty={t("— biriktirilmagan —")}
              options={(orders.data?.results || []).map((o) => ({ value: o.id, label: `№${o.number} · ${o.client_name}`, sub: money(o.amount, o.currency) }))} />
          </Field>
        )}
        {!order && k === 'client_payment' && !values.order && (
          <Field label={t("Mijoz")}>
            <SearchSelect value={values.client || ''} onChange={(id) => bind('client').onChange({ target: { value: id } })}
              options={(clients.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.phone }))} />
          </Field>
        )}
        {crossCurrency && (
          <Field label={`Buyurtma valyutasida (${curLabel(selOrder.currency)}) — bo'sh qolsa kurs bo'yicha`} full>
            <input type="number" step="0.01" min="0" {...bind('order_amount')} />
          </Field>
        )}
        <Field label={t("Izoh")} full><input {...bind('description')} /></Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

// Buyurtma hujjati — MoySklad "Заказ покупателя" uslubida
import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { CustomFieldInput, CustomFieldInputs, useCustomFields } from '../../components/CustomFields'
import { useFieldConfig } from '../../components/FieldConfig'
import { cleanNum, DocField, DocFooter, DocPage, DocTitle, newKey, Positions, useLinesTotal } from '../../components/DocEditor'
import Icon from '../../components/Icon'
import { SearchSelect } from '../../components/Controls'
import { Badge, toast, useFetch } from '../../components/ui'
import { money, todayISO } from '../../format'
import { t } from '../../i18n'
import { convertPrice, baseCurrency } from '../../currency'
import { CurrencyOptions } from '../../currency'
import { confirmDialog } from '../../components/Confirm'
import { DateInput, NumInput } from '../../components/Inputs'
import { newCounterpartyDialog } from '../../components/NewCounterparty'
import PartyBalance from '../../components/PartyBalance'

const toLines = (items) => (items || []).map((i) => ({
  key: newKey(), product: i.product, name: i.name, code: i.product_code || '', unit: i.unit, qty: cleanNum(i.qty),
  price: cleanNum(i.price), discount_pct: cleanNum(i.discount_pct), stock: null,
}))

export default function OrderForm({ refs, order: initial, fields: fieldsProp, onClose, onSaved, onCreated }) {
  const loaded = useCustomFields(fieldsProp ? null : 'order')
  const fc = useFieldConfig('order')
  const fields = fieldsProp || loaded
  const mainFields = fields.filter((f) => f.main)
  const otherFields = fields.filter((f) => !f.main)
  const priceTypes = useFetch('/warehouse/price-types/')
  const [order, setOrder] = useState(initial || null)
  const [v, setV] = useState(() => ({
    date: todayISO(), currency: baseCurrency(), amount: '', volume: '0', plan_date: '', production_date: '', client: '',
    manager: '', operator: '', note: '', extra: {}, ...(initial || {}),
  }))
  const [lines, setLines] = useState(() => toLines(initial?.items))
  const [newClient, setNewClient] = useState(null) // null — tanlash rejimi
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const total = useLinesTotal(lines)

  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setDirty(true) }
  const setL = (fn) => { setLines(fn); setDirty(true) }

  // tovar narxi: mijozning narx turi → valyutasi mos standart narx turi
  const client = refs.clients.find((c) => String(c.id) === String(v.client))
  const pts = priceTypes.data || []
  const pt = pts.find((p) => p.id === client?.price_type && p.currency === v.currency)
    || pts.find((p) => p.is_default && p.currency === v.currency) || pts.find((p) => p.currency === v.currency)
  const ptAny = pt || pts.find((p) => p.id === client?.price_type) || pts.find((p) => p.is_default) || pts[0]
  const priceOf = (p) => {
    const raw = ptAny ? p.prices?.[ptAny.id] : null
    return raw === null || raw === undefined || raw === '' ? '' : convertPrice(raw, ptAny.currency, v.currency)
  }

  useEffect(() => {
    if (!dirty) return undefined
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const save = async (close) => {
    setBusy(true)
    setError(null)
    try {
      let clientId = v.client
      if (!clientId && newClient?.trim()) {
        const { data } = await api.post('/crm/counterparties/', { name: newClient.trim() })
        clientId = data.id
        refs.reloadClients?.()
      }
      const items = lines.filter((l) => l.product || l.name?.trim()).map((l) => ({
        product: l.product || null, name: l.name || '', qty: l.qty || 0, price: l.price || 0, discount_pct: l.discount_pct || 0,
      }))
      const payload = {
        ...v, client: clientId, items, production_date: v.production_date || null, operator: v.operator || null,
        manager: v.manager || null, amount: items.length ? undefined : (v.amount || 0),
      }
      delete payload.items_count
      const isNew = !order
      const { data } = order ? await api.patch(`/orders/${order.id}/`, payload) : await api.post('/orders/', payload)
      setOrder(data)
      setV((s) => ({ ...s, ...data, client: data.client }))
      setNewClient(null)
      setDirty(false)
      setSaved(true)
      toast(t('Saqlandi'))
      if (close) onSaved(data)
      // yangi buyurtma "Saqlash"dan keyin darhol kartochkasi ochiladi (Smeta, Ishlab chiqarish, To'lovlar, Material)
      else if (isNew && onCreated) onCreated(data)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const close = async () => {
    if (dirty && !await confirmDialog(t("Saqlanmagan o'zgarishlar bor. Yopilsinmi?"))) return
    if (saved) onSaved(order)
    else onClose()
  }
  const canSave = !busy && (v.client || newClient?.trim()) && v.plan_date

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button type="button" className="btn primary" disabled={!canSave} onClick={() => save(false)}><Icon name="save" size={16} /> {busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        <button type="button" className="btn" disabled={!canSave} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>
        <button type="button" className="btn" onClick={close}>{t('Yopish')}</button>
        <span className="grow" />
        {dirty && <span className="small muted">{t("Saqlanmagan o'zgarishlar")}</span>}
        <label className="check posted-check" title={t("Belgilansa — pozitsiyalardagi tovarlar va smeta materiallari shu buyurtma uchun omborda band qilinadi")}>
          <input type="checkbox" checked={!!v.reserve} onChange={(e) => { setV((s) => ({ ...s, reserve: e.target.checked })); setDirty(true) }} /> {t('Rezerv')}
        </label>
      </>}
    >
      <DocTitle label="Buyurtma" number={order?.number} date={v.date} onDate={(d) => { setV((s) => ({ ...s, date: d })); setDirty(true) }}>
        {order && <Badge kind={order.status}>{order.status_display}</Badge>}
      </DocTitle>
      {error && <div className="error">{error}</div>}

      <div className="doc-grid">
        <div>
          <DocField label="Mijoz" required>
            {newClient === null ? (
              <SearchSelect value={v.client || ''} onChange={(id) => { setV((x) => ({ ...x, client: id })); setDirty(true) }}
                placeholder={t('Mijozni tanlang…')} options={refs.clients.map((c) => ({ value: c.id, label: c.name, sub: c.phone }))}
                onCreate={async (name) => {
                  const cp = await newCounterpartyDialog({ name, group: 'Mijozlar' })
                  if (!cp) return
                  await refs.reloadClients?.()
                  setV((x) => ({ ...x, client: cp.id })); setDirty(true)
                }} createLabel={t('Yangi mijoz')} />
            ) : (
              <div className="inline-pick">
                <input autoFocus placeholder={t('Yangi mijoz nomi')} value={newClient} onChange={(e) => { setNewClient(e.target.value); setDirty(true) }} />
                <button type="button" className="icon-act" title={t("Ro'yxatdan tanlash")} onClick={() => setNewClient(null)}><Icon name="close" size={16} /></button>
              </div>
            )}
          </DocField>
          {v.client && <PartyBalance counterparty={v.client} currency={v.currency} />}
          {!fc.hidden('manager') && <DocField label={fc.label('manager', 'Menejer')}>
            <SearchSelect value={v.manager || ''} onChange={(id) => { setV((x) => ({ ...x, manager: id })); setDirty(true) }} empty={t('— men —')}
              options={refs.users.map((u) => ({ value: u.id, label: u.full_name }))} />
          </DocField>}
          {!fc.hidden('operator') && <DocField label={fc.label('operator', 'Operator')}>
            <SearchSelect value={v.operator || ''} onChange={(id) => { setV((x) => ({ ...x, operator: id })); setDirty(true) }} empty="—"
              options={refs.users.map((u) => ({ value: u.id, label: u.full_name }))} />
          </DocField>}
        </div>
        <div>
          <DocField label="Topshirish muddati" required><DateInput value={v.plan_date || ''} onChange={set('plan_date')} /></DocField>
          {!fc.hidden('production_date') && <DocField label={fc.label('production_date', 'Ishlab chiqarish kuni')}><DateInput value={v.production_date || ''} onChange={set('production_date')} /></DocField>}
          {!fc.hidden('volume') && <DocField label={fc.label('volume', 'Hajm, m²')}><NumInput step="0.001" min="0" value={v.volume ?? ''} onChange={set('volume')} /></DocField>}
        </div>
        <div>
          <DocField label="Valyuta" required>
            <select value={v.currency} onChange={(e) => { const to = e.target.value; setLines((ls) => ls.map((l) => ({ ...l, price: l.price === '' ? '' : String(convertPrice(l.price, v.currency, to)) }))); set('currency')(e) }} disabled={!!order}>
              <CurrencyOptions withName value={v.currency} />
            </select>
          </DocField>
          {!fc.hidden('price_type') && <DocField label={fc.label('price_type', 'Narx turi')}><input value={ptAny ? `${ptAny.name}${ptAny.currency !== v.currency ? ` (${ptAny.currency} → ${v.currency})` : ''}` : '—'} readOnly className="muted-input" title={t("Mijozning narx turi yoki standart narx turi")} /></DocField>}
          {mainFields.map((f) => (
            <DocField key={f.id} label={f.name} required={f.required}>
              <CustomFieldInput f={f} value={v.extra?.[f.key]} users={refs.users}
                onChange={(val) => { setV((s) => ({ ...s, extra: { ...(s.extra || {}), [f.key]: val } })); setDirty(true) }} />
            </DocField>
          ))}
        </div>
      </div>

      {otherFields.length > 0 && (
        <div className="doc-more">
          <button type="button" className="link-btn" onClick={() => setShowMore((s) => !s)}>
            <Icon name={showMore ? 'chevron-down' : 'chevron-right'} size={15} /> {t('Boshqa maydonlar')} <span className="muted">({otherFields.length})</span>
          </button>
          {showMore && (
            <div className="form three" style={{ marginTop: 10 }}>
              <CustomFieldInputs fields={otherFields} values={v.extra || {}} onChange={(extra) => { setV((s) => ({ ...s, extra })); setDirty(true) }} users={refs.users} />
            </div>
          )}
        </div>
      )}

      <div className="doc-tabs"><span className="active">{t('Pozitsiyalar')}</span></div>
      <Positions lines={lines} setLines={setL} currency={v.currency} priceOf={priceOf} searchParams={{ for_sale: 1 }} />

      <DocFooter
        comment={v.note}
        onComment={(note) => { setV((s) => ({ ...s, note })); setDirty(true) }}
        rows={lines.length ? [
          ['Pozitsiyalar', lines.length],
          ['Jami', money(total, v.currency), true],
        ] : [
          ['Summa (pozitsiyasiz)', <NumInput key="a" className="cell num" style={{ width: 160 }} value={v.amount ?? ''} onChange={set('amount')} placeholder="0" />],
          ['Jami', money(v.amount || 0, v.currency), true],
        ]}
      />
    </DocPage>
  )
}

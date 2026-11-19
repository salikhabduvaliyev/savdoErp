import { useState } from 'react'
import { can, canCreate, canEdit, useAuth } from '../../auth'
import { CustomFieldsManager, useCustomFields } from '../../components/CustomFields'
import PageSettings, { usePageSettings } from '../../components/PageSettings'
import { Modal, Stat, useFetch } from '../../components/ui'
import { t } from '../../i18n'
import OrderCalendar from './OrderCalendar'
import OrderForm from './OrderForm'
import OrderKanban from './OrderKanban'
import OrderList, { ORDER_COLUMNS } from './OrderList'
import { OrderStatesManager } from './OrderStates'

const VIEWS = [
  ['list', t("Ro'yxat")],
  ['kanban', t("Ustunlar")],
  ['calendar', t("Kalendar")],
]
const SECTIONS = [
  { key: 'stats', label: t("Moliya kartochkalari (qarz, kassa)") },
  { key: 'filters', label: t("Filtrlar paneli") },
]

// eslint-disable-next-line react-refresh/only-export-components
export function useRefs() {
  const clients = useFetch('/crm/counterparties/', { is_active: true })
  const users = useFetch('/auth/users-lookup/')
  return { clients: clients.data || [], users: users.data || [], reloadClients: clients.reload }
}

export default function OrdersPage() {
  const [mode, setMode] = useState(() => localStorage.getItem('orders.view') || 'list')
  const [showForm, setShowForm] = useState(false)
  const [fieldsMgr, setFieldsMgr] = useState(false)
  const [statesMgr, setStatesMgr] = useState(false)
  const [stamp, setStamp] = useState(0)
  const { user } = useAuth()
  const showMoney = can(user, 'finance')
  const fields = useCustomFields('order', stamp)
  const view = usePageSettings('orders', {
    columns: [...ORDER_COLUMNS, ...fields.filter((x) => x.show_in_list).map((x) => ({ key: `x_${x.key}`, label: x.name }))],
    sections: SECTIONS,
  })
  const summary = useFetch(showMoney && view.show('stats') ? '/finance/summary/' : null, { stamp })
  const refs = useRefs()

  const switchView = (v) => {
    setMode(v)
    localStorage.setItem('orders.view', v)
  }
  const refresh = () => setStamp((s) => s + 1)

  return (
    <>
      <div className="page-head">
        <h1>{t('Buyurtmalar')}</h1>
        {canCreate(user, 'orders') && <button className="btn primary" onClick={() => setShowForm(true)}>+ {t('Buyurtma')}</button>}
        <button className={'btn' + (view.show('filters') ? ' active' : '')} onClick={() => view.toggle('filters')}>{t('Filtr')}</button>
        <div className="segmented">
          {VIEWS.map(([k, l]) => (
            <button key={k} className={mode === k ? 'active' : ''} onClick={() => switchView(k)}>{t(l)}</button>
          ))}
        </div>
        <span className="grow" />
        <PageSettings view={view} extra={<>
          {canEdit(user, 'orders') && <button className="link-btn small" onClick={() => setStatesMgr(true)}>{t('Statuslarni boshqarish…')}</button>}
          {canEdit(user, 'settings') && <button className="link-btn small" onClick={() => setFieldsMgr(true)}>{t("Qo'shimcha maydonlar…")}</button>}
        </>} />
      </div>

      {mode === 'list' && showMoney && view.show('stats') && summary.data && (
        <div className="stats">
          <Stat label={t('Mijozlar qarzi (debitor)')} bag={summary.data.client_debts} />
          <Stat label={t('Yetkazuvchilarga qarz (kreditor)')} bag={summary.data.supplier_debts} />
          <Stat label={t("Kassa/bank qoldig'i")} bag={summary.data.balances.total} />
        </div>
      )}

      {mode === 'list' && <OrderList refs={refs} stamp={stamp} view={view} fields={fields} onChanged={refresh} />}
      {mode === 'kanban' && <OrderKanban stamp={stamp} />}
      {mode === 'calendar' && <OrderCalendar stamp={stamp} />}

      {showForm && (
        <OrderForm
          refs={refs}
          fields={fields}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh() }}
        />
      )}
      {statesMgr && <OrderStatesManager onClose={() => { setStatesMgr(false); refresh() }} />}
      {fieldsMgr && (
        <Modal title={t("Buyurtma: qo'shimcha maydonlar")} onClose={() => { setFieldsMgr(false); refresh() }} wide>
          <CustomFieldsManager entity="order" />
          <p className="hint">{t("Masalan: Shartnoma summasi, Sotuv operatori, Ishlab chiqarish bo'limi (PVX/TERMO), Montaj komandasi, Chempion…")}</p>
        </Modal>
      )}
    </>
  )
}

import { useState } from 'react'
import { t } from '../../i18n'
import { ProductionDashboard, PurchaseRequests } from './Board'

// Ishlab chiqarish nazorati: ko'rsatkichlar va material zayavkalari
const TABS = [
  ['dash', t("Ko'rsatkichlar")],
  ['requests', t("Material zayavkalari")],
]

export default function ProductionDashboardPage() {
  const [tab, setTab] = useState(() => {
    const v = sessionStorage.getItem('production-dash.tab')
    return TABS.some(([k]) => k === v) ? v : 'dash'
  })
  const pick = (k) => { setTab(k); sessionStorage.setItem('production-dash.tab', k) }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Ishlab chiqarish dashboard')}</h1>
          <div className="page-sub">{t("Reja bajarilishi, bo'limlar yuklamasi, material sarfi va zayavkalar")}</div>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => pick(k)}>{l}</button>)}
      </div>
      {tab === 'dash' && <ProductionDashboard title={false} />}
      {tab === 'requests' && <PurchaseRequests />}
    </>
  )
}

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth'
import { t } from '../../i18n'
import { DeptBoard } from './Board'
import { CompletionsTab, JobsTab, LaborTab, StatusTab } from './Jobs'
import { ProdOrdersTab } from './ProdOrders'
import { ProcessesTab, StagesTab, TechCardsTab } from './TechCards'

// MoySklad "Производство" tuzilmasi
const TABS = [
  ['jobs', t("Topshiriqlar")],
  ['orders', t("Ishlab chiqarish buyurtmalari")],
  ['techcards', t("Texkartalar")],
  ['completions', t("Bosqichlarni bajarish")],
  ['labor', t("Mehnatga haq")],
  ['processes', t("Texjarayonlar")],
  ['stages', t("Bosqichlar")],
  ['status', t("Ishlab chiqarish holati")],
  ['board', t("Bo'lim ekrani")],
]

export default function ProductionPage() {
  const { user } = useAuth()
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(() => {
    const v = sp.get('tab') || sessionStorage.getItem('production.tab')
    return TABS.some(([k]) => k === v) ? v : 'jobs'
  })
  const pick = (k) => { setTab(k); sessionStorage.setItem('production.tab', k) }

  // bo'lim boshlig'i — faqat o'z bo'limi ekrani
  if (user.own_department_only) return <DeptBoard />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Ishlab chiqarish')}</h1>
          <div className="page-sub">{t("Texkartalar, buyurtmalar, topshiriqlar, bosqichlar va mehnatga haq")}</div>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => pick(k)}>{t(l)}</button>)}
      </div>
      {tab === 'jobs' && <JobsTab />}
      {tab === 'orders' && <ProdOrdersTab />}
      {tab === 'techcards' && <TechCardsTab />}
      {tab === 'completions' && <CompletionsTab />}
      {tab === 'labor' && <LaborTab />}
      {tab === 'processes' && <ProcessesTab />}
      {tab === 'stages' && <StagesTab />}
      {tab === 'status' && <StatusTab />}
      {tab === 'board' && <DeptBoard />}
    </>
  )
}

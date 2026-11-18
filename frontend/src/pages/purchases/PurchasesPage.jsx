// Xaridlar (MoySklad "Закупки"): yetkazuvchiga buyurtma → qabul qilish → qaytarish
import { useNavigate, useParams } from 'react-router-dom'
import { t } from '../../i18n'
import { DocList } from '../warehouse/StockDocs'

const TABS = [['orders', 'purchase_order', t('Yetkazuvchiga buyurtmalar')], ['supplies', 'supply', t('Qabul qilish')], ['returns', 'purchase_return', t('Yetkazuvchiga qaytarish')]]

export default function PurchasesPage() {
  const { tab: tabParam } = useParams()
  const nav = useNavigate()
  const cur = TABS.find(([k]) => k === tabParam) || TABS[1]
  return (
    <>
      <div className="tabs section-tabs">
        {TABS.map(([k, , l]) => <button key={k} className={'btn' + (cur[0] === k ? ' active' : '')} onClick={() => nav(`/purchases/${k}`)}>{l}</button>)}
      </div>
      <DocList key={cur[1]} type={cur[1]} />
    </>
  )
}

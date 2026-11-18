import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canEdit, useAuth } from '../../auth'
import { Warehouses } from '../company/CompanyPage'
import { DocList, Turnover } from './StockDocs'
import { Link } from 'react-router-dom'
import { Badge, Loading, MoneyBag, useFetch } from '../../components/ui'
import { date, money, qty } from '../../format'
import { t } from '../../i18n'

function Stocks({ stamp }) {
  const [f, setF] = useState({ warehouse: '', material__group: '', below_min: '' })
  const warehouses = useFetch('/warehouse/warehouses/')
  const groups = useFetch('/warehouse/groups/')
  const params = Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/warehouse/stock/', params)
  return (
    <div className="table-wrap">
      <div className="table-toolbar filters">
        <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
          <option value="">{t("Ombor: hammasi")}</option>
          {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={f.material__group} onChange={(e) => setF({ ...f, material__group: e.target.value })}>
          <option value="">{t("Guruh: hammasi")}</option>
          {(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className={'chip' + (f.below_min ? ' on' : '')} onClick={() => setF({ ...f, below_min: f.below_min ? '' : 'true' })}>{t("Faqat minimaldan past")}</button>
      </div>
      {!data ? <Loading error={error} /> : (
        <table className="t">
          <thead><tr><th>{t("Material")}</th><th>{t("Birlik")}</th><th>{t("Ombor")}</th><th className="num">{t("Qoldiq")}</th><th className="num">{t("Rezerv")}</th><th className="num">{t("Mavjud")}</th><th className="num">{t("Minimal")}</th><th className="num">{t("O'rtacha narx")}</th><th className="num">{t("Qiymati")}</th><th>{t("Holat")}</th></tr></thead>
          <tbody>
            {data.results.map((s) => (
              <tr key={s.id}>
                <td>{s.material_name}</td>
                <td>{s.unit}</td>
                <td>{s.warehouse_name}</td>
                <td className="num">{qty(s.qty)}</td>
                <td className="num">{qty(s.reserved)}</td>
                <td className="num bold">{qty(s.available)}</td>
                <td className="num">{qty(s.min_qty)}</td>
                <td className="num">{money(s.avg_cost, s.currency)}</td>
                <td className="num">{money(s.value, s.currency)}</td>
                <td><Badge kind={s.state}>{s.state_display}</Badge></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={8}>{t("Qoldiq qiymati (valyuta bo'yicha alohida)")}</td><td className="num"><MoneyBag bag={data.total_value} /></td><td /></tr>
          </tfoot>
        </table>
      )}
      <div className="hint" style={{ padding: '0 12px 10px' }}>{t("Holat: mavjud ≤ minimal → \"Kam\"; mavjud ≤ minimal × 1,2 → \"Minimalga yaqin\".")}</div>
    </div>
  )
}

function Moves({ type, stamp }) {
  const { data, error } = useFetch('/warehouse/moves/', { ...(type ? { type } : {}), stamp })
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{t("Sana")}</th><th>{t("Turi")}</th><th>{t("Material")}</th><th>{t("Ombor")}</th><th className="num">{t("Miqdor")}</th><th className="num">{t("Narx")}</th><th className="num">{t("Summa")}</th><th>{t("Kontragent / buyurtma")}</th><th>{t("Izoh")}</th></tr></thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id}>
              <td>{date(m.date)}</td>
              <td>{m.type_display}</td>
              <td>{m.material_name}</td>
              <td>{m.warehouse_name}{m.to_warehouse_name && ` → ${m.to_warehouse_name}`}</td>
              <td className="num">{qty(m.qty)} {m.unit}</td>
              <td className="num">{money(m.price, m.currency)}</td>
              <td className="num">{money(m.amount, m.currency)}</td>
              <td>{m.supplier_name}{m.order && <Link to={`/orders/${m.order}`}>#{m.order_number}</Link>}</td>
              <td className="small muted">{m.note}</td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={9} className="empty">{t("Harakatlar yo'q")}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// MoySklad "Склад": Kirimlar · Hisobdan chiqarish · Ko'chirish · Inventarizatsiya · Qoldiqlar · Aylanma · Harakatlar · Omborlar
const TABS = [
  ['enter', t('Kirimlar')], ['loss', t('Hisobdan chiqarish')], ['move', t("Ko'chirishlar")], ['inventory', t('Inventarizatsiya')],
  ['stock', t('Qoldiqlar')], ['turnover', t('Aylanma')], ['moves', t('Harakatlar jurnali')], ['warehouses', t('Omborlar')],
]

export default function WarehousePage() {
  const { user } = useAuth()
  const { tab: tabParam } = useParams()
  const nav = useNavigate()
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam : 'stock'
  return (
    <>
      <div className="tabs section-tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => nav(`/warehouse/${k}`)}>{l}</button>)}
      </div>
      {['enter', 'loss', 'move', 'inventory'].includes(tab) && <DocList key={tab} type={tab} />}
      {tab === 'stock' && <><div className="page-head"><h1>{t('Qoldiqlar')}</h1></div><Stocks stamp={0} /></>}
      {tab === 'turnover' && <><div className="page-head"><h1>{t('Aylanma')}</h1><span className="page-sub">{t("Davr boshidagi qoldiq, kirim, chiqim va davr oxiridagi qoldiq")}</span></div><Turnover /></>}
      {tab === 'moves' && <><div className="page-head"><h1>{t('Harakatlar jurnali')}</h1></div><Moves stamp={0} /></>}
      {tab === 'warehouses' && <Warehouses editable={canEdit(user, 'company') || canEdit(user, 'warehouse')} />}
    </>
  )
}

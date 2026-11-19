// Kompaniya tarixi: kim, qachon, nimani yaratdi / o'zgartirdi / o'chirdi
import { useMemo, useState } from 'react'
import { SearchSelect, usePager } from '../../components/Controls'
import Icon from '../../components/Icon'
import { Badge, Loading, useFetch } from '../../components/ui'
import { t } from '../../i18n'

const ENTITIES = [
  ['order', t('Buyurtma')], ['sale', t('Sotuv')], ['production_order', t('Ishlab chiqarish buyurtmasi')],
  ['production_job', t('Ishlab chiqarish topshirig\'i')], ['techcard', t('Texkarta')], ['stock_doc', t('Ombor hujjati')],
  ['product', t('Tovar')], ['counterparty', t('Kontragent')], ['transaction', t("To'lov")],
]
const ACTIONS = [['create', t('Yaratildi')], ['update', t("O'zgartirildi")], ['delete', t("O'chirildi")], ['start', t('Ishga tushirildi')]]
const KIND = { create: 'ok', update: 'confirmed', delete: 'cancelled', start: 'in_production', status: 'confirmed' }

export default function History() {
  const empty = { entity: '', action: '', user: '', date_from: '', date_to: '', search: '' }
  const [f, setF] = useState(empty)
  const q = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f])
  const { data, error } = useFetch('/core/audit/', q)
  const users = useFetch('/auth/users-lookup/')
  const { rows, pager } = usePager(data, 50, JSON.stringify(q))
  return (
    <>
      <div className="page-head"><div><h1>{t('Tarix')}</h1><div className="page-sub">{t("Hujjatlar va ma'lumotnomalardagi barcha o'zgarishlar: kim, qachon, nimani o'zgartirdi")}</div></div></div>
      <div className="filter-panel card">
        <div className="filter-grid">
          <label>{t('Qidirish')}<input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder={t('Hujjat raqami yoki nomi')} /></label>
          <label>{t('Obyekt')}
            <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">{t('hammasi')}</option>{ENTITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>{t('Amal')}
            <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">{t('hammasi')}</option>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>{t('Foydalanuvchi')}
            <SearchSelect value={f.user} onChange={(id) => setF({ ...f, user: id })} empty={t('hammasi')} options={(users.data || []).map((u) => ({ value: u.id, label: u.full_name }))} />
          </label>
          <label>{t('Davr')}<div className="inline-pick"><input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />—<input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></div></label>
        </div>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Vaqt')}</th><th>{t('Foydalanuvchi')}</th><th>{t('Amal')}</th><th>{t('Obyekt')}</th><th>{t("O'zgarishlar")}</th></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="nowrap small">{new Date(h.created_at).toLocaleString()}</td>
                  <td className="nowrap"><Icon name="user" size={14} /> {h.user_name || '—'}</td>
                  <td><Badge kind={KIND[h.action]}>{t(h.action_display)}</Badge></td>
                  <td className="bold">{h.title}</td>
                  <td className="small">
                    {Object.entries(h.changes || {}).map(([k, [a, b]]) => (
                      <div key={k}><span className="muted">{t(k)}:</span> <s className="muted">{String(a ?? '—')}</s> → <b>{String(b ?? '—')}</b></div>
                    ))}
                  </td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={5} className="empty">{t("Yozuvlar yo'q")}</td></tr>}
            </tbody>
          </table>
          {pager}
        </div>
      )}
    </>
  )
}

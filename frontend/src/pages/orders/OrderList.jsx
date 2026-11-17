import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { CustomFieldFilter, formatExtra } from '../../components/CustomFields'
import { Badge, Loading, MoneyBag, toast, useFetch } from '../../components/ui'
import { date, money } from '../../format'
import { t } from '../../i18n'

// eslint-disable-next-line react-refresh/only-export-components
export const STATUSES = [
  ['new', t("Yangi")],
  ['confirmed', t("Tasdiqlandi")],
  ['in_production', t("Ishlab chiqarishda")],
  ['ready', t("Tayyor")],
  ['delivered', t("Topshirildi")],
  ['cancelled', t("Bekor qilindi")],
]

/** Buyurtmalar ro'yxati ustunlari (⚙ orqali yashiriladi) */
// eslint-disable-next-line react-refresh/only-export-components
export const ORDER_COLUMNS = [
  { key: 'number', label: t("Raqam"), fixed: true },
  { key: 'date', label: t("Sana") },
  { key: 'client', label: t("Mijoz"), fixed: true },
  { key: 'amount', label: t("Summa") },
  { key: 'currency', label: t("Valyuta") },
  { key: 'paid', label: t("To'langan") },
  { key: 'debt_uzs', label: t("Qarz (so'm)") },
  { key: 'debt_usd', label: t("Qarz (USD)") },
  { key: 'plan_date', label: t("Reja sana") },
  { key: 'production_date', label: t("Ishlab chiqarish kuni"), hidden: true },
  { key: 'status', label: t("Status") },
  { key: 'stage', label: t("Bo'lim") },
  { key: 'manager', label: t("Menejer"), hidden: true },
  { key: 'operator', label: t("Operator"), hidden: true },
  { key: 'branch', label: t("Filial"), hidden: true },
  { key: 'note', label: t("Izoh"), hidden: true },
]

export default function OrderList({ refs, stamp, view, fields = [], onChanged }) {
  const nav = useNavigate()
  const [f, setF] = useState({})
  const [xf, setXf] = useState({})
  const [selected, setSelected] = useState([])
  const [bulkStatus, setBulkStatus] = useState('')
  const params = useMemo(() => {
    const p = { ...f, stamp }
    Object.entries(xf).forEach(([k, v]) => { if (v !== '' && v !== undefined) p[`x_${k}`] = v })
    Object.keys(p).forEach((k) => (p[k] === '' || p[k] === false || p[k] === undefined) && delete p[k])
    return p
  }, [f, xf, stamp])
  const { data, error, reload } = useFetch('/orders/', params)
  const show = view.show
  const listFields = fields.filter((x) => x.show_in_list && show(`x_${x.key}`))

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggle = (k) => setF((s) => ({ ...s, [k]: s[k] ? '' : 'true' }))
  const toggleRow = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const applyBulk = async () => {
    if (!bulkStatus || !selected.length) return
    try {
      await api.post('/orders/bulk_status/', { ids: selected, status: bulkStatus })
      toast(t("{n} ta buyurtma statusi o'zgartirildi", { n: selected.length }))
      setSelected([])
      reload()
      onChanged?.()
    } catch (e) {
      toast(errorText(e), true)
    }
  }

  const users = refs.users
  // ustunlar soni (tfoot uchun)
  const lead = 1 + ['number', 'date', 'client'].filter(show).length

  return (
    <>
      {show('filters') && (
        <div className="card filters" style={{ marginBottom: 12 }}>
          <input placeholder={t('Raqam yoki mijoz…')} value={f.search || ''} onChange={set('search')} style={{ width: 180 }} />
          <span className="muted small">{t('Davr')}</span>
          <input type="date" value={f.date_from || ''} onChange={set('date_from')} />
          <input type="date" value={f.date_to || ''} onChange={set('date_to')} />
          <span className="muted small">{t('Reja sana')}</span>
          <input type="date" value={f.plan_from || ''} onChange={set('plan_from')} />
          <input type="date" value={f.plan_to || ''} onChange={set('plan_to')} />
          <select value={f.client || ''} onChange={set('client')}>
            <option value="">{t('Mijoz: hammasi')}</option>
            {refs.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={f.status || ''} onChange={set('status')}>
            <option value="">{t('Status: hammasi')}</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
          <select value={f.currency || ''} onChange={set('currency')}>
            <option value="">{t('Valyuta: hammasi')}</option>
            <option value="UZS">{t("so'm")}</option>
            <option value="USD">USD</option>
          </select>
          <select value={f.manager || ''} onChange={set('manager')}>
            <option value="">{t('Menejer')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select value={f.operator || ''} onChange={set('operator')}>
            <option value="">{t('Operator')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          {fields.filter((x) => x.filterable).map((x) => (
            <CustomFieldFilter key={x.id} f={x} value={xf[x.key]} users={users} onChange={(v) => setXf({ ...xf, [x.key]: v })} />
          ))}
          <button className={'chip' + (f.overdue ? ' on' : '')} onClick={() => toggle('overdue')}>{t('Kechikkan')}</button>
          <button className={'chip' + (f.has_debt ? ' on' : '')} onClick={() => toggle('has_debt')}>{t('Qarzi bor')}</button>
          <button className={'chip' + (f.negative_profit ? ' on' : '')} onClick={() => toggle('negative_profit')}>{t('Foyda: manfiy')}</button>
          {(Object.values(f).some(Boolean) || Object.values(xf).some(Boolean)) && (
            <button className="link-btn small" onClick={() => { setF({}); setXf({}) }}>{t('Tozalash')}</button>
          )}
        </div>
      )}

      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <div className="table-toolbar">
            <b>{t('Hammasi')} {data.count}</b>
            {selected.length > 0 && (
              <>
                <span className="muted">{t('Tanlangan')}: {selected.length}</span>
                <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="chip">
                  <option value="">{t("Statusni o'zgartirish…")}</option>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
                <button className="btn small primary" disabled={!bulkStatus} onClick={applyBulk}>{t("Qo'llash")}</button>
              </>
            )}
          </div>
          <table className={view.tableClass}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input type="checkbox" checked={selected.length === data.results.length && data.results.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? data.results.map((o) => o.id) : [])} />
                </th>
                {show('number') && <th>{t('Raqam')}</th>}
                {show('date') && <th>{t('Sana')}</th>}
                {show('client') && <th>{t('Mijoz')}</th>}
                {show('amount') && <th className="num">{t('Summa')}</th>}
                {show('currency') && <th>{t('Valyuta')}</th>}
                {show('paid') && <th className="num">{t("To'langan")}</th>}
                {show('debt_uzs') && <th className="num">{t("Qarz (so'm)")}</th>}
                {show('debt_usd') && <th className="num">{t('Qarz (USD)')}</th>}
                {show('plan_date') && <th>{t('Reja sana')}</th>}
                {show('production_date') && <th>{t('Ishlab chiqarish kuni')}</th>}
                {show('status') && <th>{t('Status')}</th>}
                {show('stage') && <th>{t("Bo'lim")}</th>}
                {show('manager') && <th>{t('Menejer')}</th>}
                {show('operator') && <th>{t('Operator')}</th>}
                {show('branch') && <th>{t('Filial')}</th>}
                {show('note') && <th>{t('Izoh')}</th>}
                {listFields.map((x) => <th key={x.id}>{x.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.results.map((o) => {
                const debt = Number(o.debt)
                return (
                  <tr key={o.id} className={'clickable' + (o.is_overdue ? ' row-danger' : '')} onClick={() => nav(`/orders/${o.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleRow(o.id)} />
                    </td>
                    {show('number') && <td><a href={`/orders/${o.id}`} onClick={(e) => e.preventDefault()}>{o.number}</a></td>}
                    {show('date') && <td>{date(o.date)}</td>}
                    {show('client') && <td className="nowrap">{o.client_name}</td>}
                    {show('amount') && <td className="num">{money(o.amount, o.currency)}</td>}
                    {show('currency') && <td>{o.currency === 'USD' ? 'USD' : t("so'm")}</td>}
                    {show('paid') && <td className="num">{money(o.paid, o.currency)}</td>}
                    {show('debt_uzs') && <td className="num bold">{o.currency === 'UZS' ? (debt ? money(debt, 'UZS') : <span className="muted">0</span>) : <span className="muted">—</span>}</td>}
                    {show('debt_usd') && <td className="num bold">{o.currency === 'USD' ? (debt ? money(debt, 'USD') : <span className="muted">$ 0,00</span>) : <span className="muted">—</span>}</td>}
                    {show('plan_date') && (
                      <td className={o.is_overdue ? 'red' : ''} title={o.is_overdue ? t('{n} kun kechikkan', { n: o.overdue_days }) : ''}>
                        {date(o.plan_date)}{o.is_overdue && <span className="small"> · {t('{n} kun', { n: o.overdue_days })}</span>}
                      </td>
                    )}
                    {show('production_date') && <td>{date(o.production_date)}</td>}
                    {show('status') && <td><Badge kind={o.status}>{t(o.status_display)}</Badge></td>}
                    {show('stage') && <td className="muted small">{o.stage || '—'}</td>}
                    {show('manager') && <td className="small">{o.manager_name || '—'}</td>}
                    {show('operator') && <td className="small">{o.operator_name || '—'}</td>}
                    {show('branch') && <td className="small">{o.branch_name || '—'}</td>}
                    {show('note') && <td className="small muted">{o.note || '—'}</td>}
                    {listFields.map((x) => <td key={x.id}>{formatExtra(x, o.extra?.[x.key], users)}</td>)}
                  </tr>
                )
              })}
              {!data.results.length && <tr><td colSpan={30} className="empty">{t('Buyurtma topilmadi')}</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={lead}>{t("Jami (valyuta bo'yicha alohida)")}</td>
                {show('amount') && <td className="num"><MoneyBag bag={data.totals.amount} /></td>}
                {show('currency') && <td />}
                {show('paid') && <td className="num"><MoneyBag bag={data.totals.paid} /></td>}
                {show('debt_uzs') && <td className="num">{money(data.totals.debt.UZS, 'UZS')}</td>}
                {show('debt_usd') && <td className="num">{money(data.totals.debt.USD, 'USD')}</td>}
                <td colSpan={20} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="legend">
        <span>{t("Qizil qator — reja sanasi o'tgan va topshirilmagan buyurtma")}</span>
        <span>{t('"Bo\'lim" — buyurtma hozir qaysi bo\'limda (statusdan alohida)')}</span>
      </div>
    </>
  )
}

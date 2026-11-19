import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { CustomFieldFilter, formatExtra } from '../../components/CustomFields'
import { Badge, Loading, MoneyBag, toast, useFetch } from '../../components/ui'
import { date, money } from '../../format'
import { t } from '../../i18n'
import { curLabel, CurrencyOptions } from '../../currency'
import { BulkMenu, SearchSelect, usePager } from '../../components/Controls'

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
  const users = refs.users
  const [f, setF] = useState({})
  const [xf, setXf] = useState({})
  const [selected, setSelected] = useState([])
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

  // MoySklad "Изменить": tanlanganlar ustida amal
  const bulk = async (action, extra = {}, confirmText) => {
    if (!selected.length) return
    if (confirmText && !window.confirm(confirmText)) return
    try {
      const { data: r } = await api.post('/orders/bulk/', { ids: selected, action, ...extra })
      if (r.errors?.length) toast(r.errors.join('\n'), true)
      if (r.done) toast(t('Bajarildi: {n} ta', { n: r.done }))
      setSelected([])
      reload()
      onChanged?.()
    } catch (e) {
      toast(errorText(e), true)
    }
  }
  const { rows: pageRows, pager } = usePager(data?.results, 50, JSON.stringify(params))
  const clientOptions = useMemo(() => refs.clients.map((c) => ({ value: c.id, label: c.name, sub: c.phone })), [refs.clients])
  const userOptions = useMemo(() => users.map((u) => ({ value: u.id, label: u.full_name })), [users])
  const active = Object.values(f).some(Boolean) || Object.values(xf).some(Boolean)

  // ustunlar soni (tfoot uchun)
  const lead = 1 + ['number', 'date', 'client'].filter(show).length

  return (
    <>
      {show('filters') && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{t('Qidirish')}
              <input placeholder={t('Raqam, mijoz yoki izoh')} value={f.search || ''} onChange={set('search')} />
            </label>
            <label>{t('Sana (davr)')}
              <div className="inline-pick"><input type="date" value={f.date_from || ''} onChange={set('date_from')} />—<input type="date" value={f.date_to || ''} onChange={set('date_to')} /></div>
            </label>
            <label>{t('Reja sana')}
              <div className="inline-pick"><input type="date" value={f.plan_from || ''} onChange={set('plan_from')} />—<input type="date" value={f.plan_to || ''} onChange={set('plan_to')} /></div>
            </label>
            <label>{t('Mijoz')}
              <SearchSelect value={f.client || ''} onChange={(v) => setF((s0) => ({ ...s0, client: v }))} options={clientOptions} empty={t('hammasi')} />
            </label>
            <label>{t('Status')}
              <select value={f.status || ''} onChange={set('status')}>
                <option value="">{t('hammasi')}</option>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </label>
            <label>{t('Valyuta')}
              <select value={f.currency || ''} onChange={set('currency')}><option value="">{t('hammasi')}</option><CurrencyOptions /></select>
            </label>
            <label>{t('Menejer')}
              <SearchSelect value={f.manager || ''} onChange={(v) => setF((s0) => ({ ...s0, manager: v }))} options={userOptions} empty={t('hammasi')} />
            </label>
            <label>{t('Operator')}
              <SearchSelect value={f.operator || ''} onChange={(v) => setF((s0) => ({ ...s0, operator: v }))} options={userOptions} empty={t('hammasi')} />
            </label>
            {fields.filter((x) => x.filterable).map((x) => (
              <label key={x.id}>{x.name}<CustomFieldFilter f={x} value={xf[x.key]} users={users} onChange={(v) => setXf({ ...xf, [x.key]: v })} /></label>
            ))}
          </div>
          <div className="filter-actions">
            <button className={'chip' + (f.overdue ? ' on' : '')} onClick={() => toggle('overdue')}>{t('Kechikkan')}</button>
            <button className={'chip' + (f.has_debt ? ' on' : '')} onClick={() => toggle('has_debt')}>{t('Qarzi bor')}</button>
            <button className={'chip' + (f.negative_profit ? ' on' : '')} onClick={() => toggle('negative_profit')}>{t('Foyda: manfiy')}</button>
            <span className="grow" />
            {active && <button className="btn small" onClick={() => { setF({}); setXf({}) }}>{t('Tozalash')}</button>}
          </div>
        </div>
      )}

      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <div className="table-toolbar">
            <b>{t('Hammasi')} {data.count}</b>
            <BulkMenu count={selected.length} items={[
              { label: t('Status'), sub: STATUSES.map(([v, l]) => ({ label: t(l), onClick: () => bulk('status', { status: v }) })) },
              { label: t('Nusxa olish'), onClick: () => bulk('copy') },
              { divider: true },
              { label: t("O'chirish"), danger: true, onClick: () => bulk('delete', {}, t("Tanlangan buyurtmalar o'chirilsinmi? To'lov yoki sotuvi borlari o'chirilmaydi.")) },
            ]} />
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
              {pageRows.map((o) => {
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
                    {show('currency') && <td>{curLabel(o.currency)}</td>}
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
          {pager}
        </div>
      )}
      <div className="legend">
        <span>{t("Qizil qator — reja sanasi o'tgan va topshirilmagan buyurtma")}</span>
        <span>{t('"Bo\'lim" — buyurtma hozir qaysi bo\'limda (statusdan alohida)')}</span>
      </div>
    </>
  )
}

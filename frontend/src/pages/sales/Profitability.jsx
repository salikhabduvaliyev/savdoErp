// MoySklad "Прибыльность": davr bo'yicha tovar / mijoz / sotuvchi kesimida sotuv, qaytarish, tannarx, foyda va rentabellik
import { useMemo, useState } from 'react'
import { Loading, Stat, useFetch } from '../../components/ui'
import { usePager } from '../../components/Controls'
import Icon from '../../components/Icon'
import { CurrencyOptions } from '../../currency'
import { money, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'

const BY = [['product', tr('Tovarlar')], ['client', tr('Mijozlar')], ['seller', tr('Sotuvchilar')]]
const monthStart = () => todayISO().slice(0, 8) + '01'

export default function Profitability() {
  const [f, setF] = useState({ date_from: monthStart(), date_to: todayISO(), by: 'product', currency: 'UZS' })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(['profit', -1])
  const { data, error } = useFetch('/sales/profitability/', f)
  const cur = data?.currency || f.currency
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (data?.rows || []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q))
    const [k, d] = sort
    return [...list].sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : Number(a[k] ?? -1e18) - Number(b[k] ?? -1e18)) * d)
  }, [data, search, sort])
  const { rows: pageRows, pager } = usePager(rows, 50, JSON.stringify(f) + search)
  const isProduct = f.by === 'product'
  const th = (k, l, cls = 'num') => (
    <th className={cls + ' sortable'} onClick={() => setSort(([sk, sd]) => [k, sk === k ? -sd : -1])} style={{ cursor: 'pointer' }}>
      {l}{sort[0] === k ? (sort[1] < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )
  const T = data?.totals

  return (
    <div className="page">
      <div className="page-head"><h1>{tr('Foydalilik')}</h1></div>
      <div className="prof-bar">
        <div className="tabs">
          {BY.map(([k, l]) => <button key={k} className={'btn' + (f.by === k ? ' active' : '')} onClick={() => setF({ ...f, by: k })}>{l}</button>)}
        </div>
        <div className="prof-dates">
          <input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />—
          <input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        </div>
        <select className="prof-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><CurrencyOptions /></select>
        <div className="psearch" style={{ maxWidth: 300, minWidth: 200 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={isProduct ? tr('Tovar nomi yoki kodi') : tr('Nomi')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {data?.warnings?.length > 0 && <div className="card red" style={{ marginBottom: 12 }}>{data.warnings.join('; ')}</div>}
      {T && (
        <div className="stats prof-stats">
          <Stat label="Sotuv summasi" value={money(T.revenue, cur)} />
          <Stat label="Qaytarishlar" value={money(T.ret_amount, cur)} />
          <Stat label="Tannarx" value={money(Number(T.cost) - Number(T.ret_cost), cur)} />
          <Stat label="Foyda" valueClass={Number(T.profit) < 0 ? 'red' : 'green'} value={money(T.profit, cur)} />
          <Stat label="Rentabellik" value={T.margin_pct != null ? `${T.margin_pct}%` : '—'} />
        </div>
      )}
      <div className="table-wrap">
        {!data ? <Loading error={error} /> : (
          <table className="t prof-t">
            <thead>
              <tr>
                <th rowSpan={2}>№</th>
                {th('name', isProduct ? tr('Tovar') : f.by === 'client' ? tr('Mijoz') : tr('Sotuvchi'), '')}
                <th colSpan={isProduct ? 5 : 3} style={{ textAlign: 'center' }}>{tr('Sotuvlar')}</th>
                <th colSpan={3} style={{ textAlign: 'center' }}>{tr('Qaytarishlar')}</th>
                {th('profit', tr('Foyda'))}
                {th('margin_pct', tr('Rentabellik'))}
              </tr>
              <tr>
                <th />
                {th('docs', tr('Hujjat'))}
                {isProduct && th('qty', tr('Miqdor'))}
                {isProduct && th('price', tr('O\'rt. narx'))}
                {th('revenue', tr('Summa'))}
                {th('cost', tr('Tannarx'))}
                {th('ret_docs', tr('Hujjat'))}
                {th('ret_amount', tr('Summa'))}
                {th('ret_cost', tr('Tannarx'))}
                <th /><th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, n) => (
                <tr key={r.key}>
                  <td className="muted">{n + 1}</td>
                  <td className="prof-name">{r.name}{r.code && <span className="small muted"> · {r.code}</span>}</td>
                  <td className="num">{r.docs}</td>
                  {isProduct && <td className="num">{qty(r.qty)} {tr(r.unit || '')}</td>}
                  {isProduct && <td className="num">{money(r.price, cur)}</td>}
                  <td className="num">{money(r.revenue, cur)}</td>
                  <td className="num muted">{money(r.cost, cur)}</td>
                  <td className="num">{r.ret_docs || '—'}</td>
                  <td className="num">{Number(r.ret_amount) ? money(r.ret_amount, cur) : '—'}</td>
                  <td className="num muted">{Number(r.ret_cost) ? money(r.ret_cost, cur) : '—'}</td>
                  <td className={'num bold ' + (Number(r.profit) < 0 ? 'red' : 'green')}>{money(r.profit, cur)}</td>
                  <td className={'num ' + (Number(r.margin_pct) < 0 ? 'red' : '')}>{r.margin_pct != null ? `${r.margin_pct}%` : '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={14} className="empty">{tr("Bu davrda sotuvlar yo'q")}</td></tr>}
            </tbody>
            {T && rows.length > 0 && (
              <tfoot>
                <tr className="bold">
                  <td /><td>{tr('Jami')}</td><td className="num">{T.docs}</td>
                  {isProduct && <><td /><td /></>}
                  <td className="num">{money(T.revenue, cur)}</td><td className="num">{money(T.cost, cur)}</td>
                  <td />
                  <td className="num">{money(T.ret_amount, cur)}</td><td className="num">{money(T.ret_cost, cur)}</td>
                  <td className={'num ' + (Number(T.profit) < 0 ? 'red' : 'green')}>{money(T.profit, cur)}</td>
                  <td className="num">{T.margin_pct != null ? `${T.margin_pct}%` : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
        {pager}
      </div>
    </div>
  )
}

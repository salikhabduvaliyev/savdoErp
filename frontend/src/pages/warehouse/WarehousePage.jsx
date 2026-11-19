import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canEdit, useAuth } from '../../auth'
import { Warehouses } from '../company/CompanyPage'
import { DocList, Turnover } from './StockDocs'
import { Link } from 'react-router-dom'
import { Badge, Loading, Modal, MoneyBag, useFetch } from '../../components/ui'
import Icon from '../../components/Icon'
import { downloadFile } from '../../components/Download'
import { esc, openPrint } from '../../components/Print'
import { curLabel } from '../../currency'
import { date, money, qty, todayISO } from '../../format'
import { t } from '../../i18n'
import { usePager } from '../../components/Controls'

const STOCK_MODES = [['all', 'Hammasi'], ['positive', 'Musbat'], ['nonzero', 'Noldan farqli'], ['zero', 'Nol'], ['negative', 'Manfiy']]
const MAT_TYPES = [['raw', 'Xomashyo / material'], ['product', 'Tayyor mahsulot'], ['goods', 'Tovar (qayta sotish)']]
const EMPTY_F = { date: '', warehouse: '', group: '', type: '', stock: 'all', below_min: '', search: '' }
const EXPORT_FMTS = [
  ['browser', 'Brauzerda ochish', 'view'],
  ['xlsx', 'Excel (.xlsx) formatida yuklab olish', 'download'],
  ['pdf', 'PDF formatida (chop etish → PDF sifatida saqlash)', 'print'],
  ['csv', 'CSV formatida yuklab olish', 'download'],
]

/** Guruhlar daraxti → chekinishli ro'yxat */
function groupOptions(groups) {
  const kids = {}
  groups.forEach((g) => { (kids[g.parent || 0] = kids[g.parent || 0] || []).push(g) })
  const out = []
  const walk = (pid, depth) => (kids[pid] || []).sort((x, y) => x.name.localeCompare(y.name)).forEach((g) => {
    out.push([g.id, '   '.repeat(depth) + g.name])
    walk(g.id, depth + 1)
  })
  walk(0, 0)
  return out
}

/* Qoldiqlarni yuklab olish (MoySklad "Печать / Экспорт": brauzerda, Excel, PDF, CSV) */
function StockExport({ params, rows, totals, title, onClose }) {
  const [fmt, setFmt] = useState('xlsx')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (fmt === 'xlsx' || fmt === 'csv') {
      setBusy(true)
      await downloadFile('/warehouse/stock/export/', { ...params, fmt }, `qoldiqlar.${fmt}`)
      setBusy(false)
    } else {
      const body = rows.map((r, n) => `<tr><td>${n + 1}</td><td>${esc(r.code)}</td><td>${esc(r.material_name)}</td><td>${esc(r.warehouse_name)}</td><td>${esc(r.unit)}</td>
        <td class="num">${qty(r.qty)}</td><td class="num">${money(r.avg_cost, r.currency)}</td><td class="num">${money(r.value, r.currency)}</td></tr>`).join('')
      const tot = Object.entries(totals || {}).filter(([, v]) => Number(v))
        .map(([c, v]) => `<tr class="tot"><td colspan="7">${esc(t('Jami'))} (${esc(curLabel(c))})</td><td class="num">${money(v, c)}</td></tr>`).join('')
      openPrint(title, `<h1>${esc(title)}</h1><div class="muted">${esc(t('Pozitsiyalar'))}: ${rows.length}</div>
        <table><thead><tr><th>№</th><th>${esc(t('Kod'))}</th><th>${esc(t('Nomi'))}</th><th>${esc(t('Ombor'))}</th><th>${esc(t('Birlik'))}</th>
        <th>${esc(t('Qoldiq'))}</th><th>${esc(t("O'rtacha narx"))}</th><th>${esc(t('Qiymati'))}</th></tr></thead>
        <tbody>${body}</tbody><tfoot>${tot}</tfoot></table>`, undefined, fmt === 'pdf')
    }
    onClose()
  }
  return (
    <Modal dialog title={t('Qoldiqlarni yuklab olish')} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{title} · {t('Pozitsiyalar')}: {rows.length}</p>
      <div className="export-opts">
        {EXPORT_FMTS.map(([k, l, ic]) => (
          <label key={k} className={'export-opt' + (fmt === k ? ' on' : '')}>
            <input type="radio" name="fmt" checked={fmt === k} onChange={() => setFmt(k)} /><Icon name={ic} size={16} /> {t(l)}
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>{t('Bekor qilish')}</button>
        <button className="btn primary" disabled={busy || !rows.length} onClick={go}>{busy ? t('Tayyorlanmoqda…') : t('Yuklab olish')}</button>
      </div>
    </Modal>
  )
}

function Stocks({ stamp }) {
  const [f, setF] = useState(EMPTY_F)
  const [showFilter, setShowFilter] = useState(false)
  const [exp, setExp] = useState(false)
  const warehouses = useFetch('/warehouse/warehouses/')
  const groups = useFetch('/warehouse/groups/')
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== 'all'))
  const { data, error } = useFetch('/warehouse/stock/', { ...params, stamp })
  const { rows: pageRows, pager } = usePager(data?.results, 50, JSON.stringify(f))
  const historic = !!f.date && f.date < todayISO()
  const active = Object.keys(params).filter((k) => k !== 'search').length
  const whName = (warehouses.data || []).find((w) => String(w.id) === String(f.warehouse))?.name
  const title = `${t('Qoldiqlar')} — ${f.date ? date(f.date) : t('hozirgi holat')}${whName ? ` · ${whName}` : ''}`
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }))
  return (
    <>
      <div className="list-toolbar">
        <button className={'btn' + (showFilter ? ' active' : '')} onClick={() => setShowFilter((x) => !x)}>
          <Icon name="filter" size={15} /> {t('Filtr')}{active > 0 && <span className="filter-count">{active}</span>}
        </button>
        <div className="psearch" style={{ maxWidth: 340, minWidth: 220 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={t('Nomi, kodi, artikul yoki shtrix-kod')} value={f.search} onChange={(e) => set('search', e.target.value)} />
        </div>
        <label className="inline-pick stock-date" title={t("Bo'sh — hozirgi qoldiq")}>
          <span className="muted small">{t('Sanaga qoldiq')}</span>
          <input type="date" value={f.date} max={todayISO()} onChange={(e) => set('date', e.target.value)} />
        </label>
        <span className="grow" />
        <button className="btn" onClick={() => setExp(true)} disabled={!data}><Icon name="download" size={16} /> {t('Yuklab olish')}</button>
      </div>
      {showFilter && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{t('Ombor')}
              <select value={f.warehouse} onChange={(e) => set('warehouse', e.target.value)}>
                <option value="">{t('hammasi')}</option>
                {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label>{t('Guruh')}
              <select value={f.group} onChange={(e) => set('group', e.target.value)}>
                <option value="">{t('hammasi')}</option>
                <option value="none">{t('Guruhsiz')}</option>
                {groupOptions(groups.data || []).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </label>
            <label>{t('Tovar turi')}
              <select value={f.type} onChange={(e) => set('type', e.target.value)}>
                <option value="">{t('hammasi')}</option>
                {MAT_TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
            </label>
            <label>{t('Qoldiq')}
              <select value={f.stock} onChange={(e) => set('stock', e.target.value)}>
                {STOCK_MODES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
            </label>
            <label>{t('Holat')}
              <select value={f.below_min} onChange={(e) => set('below_min', e.target.value)}>
                <option value="">{t('hammasi')}</option>
                <option value="true">{t('Faqat minimaldan past')}</option>
              </select>
            </label>
          </div>
          <div className="filter-actions">
            <button className="btn" onClick={() => setF(EMPTY_F)}>{t('Tozalash')}</button>
          </div>
        </div>
      )}
      {historic && <div className="hint" style={{ marginBottom: 8 }}>{t("{d} sanasi oxiridagi qoldiq ko'rsatilmoqda (harakatlar bo'yicha hisoblangan, rezervsiz).", { d: date(f.date) })}</div>}
      <div className="table-wrap">
        <div className="table-toolbar"><b>{t('Hammasi')} {data?.count ?? ''}</b></div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>{t("Kod")}</th><th>{t("Material")}</th><th>{t("Birlik")}</th><th>{t("Ombor")}</th><th className="num">{t("Qoldiq")}</th>
              {!historic && <><th className="num">{t("Rezerv")}</th><th className="num">{t("Mavjud")}</th></>}
              <th className="num">{t("Minimal")}</th><th className="num">{t("O'rtacha narx")}</th><th className="num">{t("Qiymati")}</th><th>{t("Holat")}</th></tr></thead>
            <tbody>
              {pageRows.map((s) => (
                <tr key={s.id}>
                  <td className="muted small">{s.code}</td>
                  <td>{s.material_name}{s.group_name && <div className="small muted">{s.group_name}</div>}</td>
                  <td>{s.unit}</td>
                  <td>{s.warehouse_name}</td>
                  <td className={'num' + (Number(s.qty) < 0 ? ' red' : '')}>{qty(s.qty)}</td>
                  {!historic && <><td className="num">{qty(s.reserved)}</td><td className="num bold">{qty(s.available)}</td></>}
                  <td className="num">{qty(s.min_qty)}</td>
                  <td className="num">{money(s.avg_cost, s.currency)}</td>
                  <td className="num">{money(s.value, s.currency)}</td>
                  <td><Badge kind={s.state}>{t(s.state_display)}</Badge></td>
                </tr>
              ))}
              {!data.results.length && <tr><td colSpan={11} className="empty">{t("Filtr bo'yicha qoldiq topilmadi")}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan={historic ? 7 : 9}>{t("Qoldiq qiymati (valyuta bo'yicha alohida)")}</td><td className="num"><MoneyBag bag={data.total_value} /></td><td /></tr>
            </tfoot>
          </table>
        )}
        {pager}
        <div className="hint" style={{ padding: '0 12px 10px' }}>{t("Holat: mavjud ≤ minimal → \"Kam\"; mavjud ≤ minimal × 1,2 → \"Minimalga yaqin\".")}</div>
      </div>
      {exp && data && <StockExport params={params} rows={data.results} totals={data.total_value} title={title} onClose={() => setExp(false)} />}
    </>
  )
}

function Moves({ type, stamp }) {
  const { data, error } = useFetch('/warehouse/moves/', { ...(type ? { type } : {}), stamp })
  const { rows: pageRows, pager } = usePager(data, 50, type)
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{t("Sana")}</th><th>{t("Turi")}</th><th>{t("Material")}</th><th>{t("Ombor")}</th><th className="num">{t("Miqdor")}</th><th className="num">{t("Narx")}</th><th className="num">{t("Summa")}</th><th>{t("Kontragent / buyurtma")}</th><th>{t("Izoh")}</th></tr></thead>
        <tbody>
          {pageRows.map((m) => (
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
          {pager}
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

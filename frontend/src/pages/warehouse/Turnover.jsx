// Aylanma (MoySklad "Обороты"): davr boshi / kirim / chiqim / davr oxiri — soni va summasi.
// Qatorni bosganda o'ng tomonda shu tovarning davrdagi harakatlari (hujjatlar) ochiladi.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loading, MoneyBag, useFetch } from '../../components/ui'
import { usePager } from '../../components/Controls'
import Icon from '../../components/Icon'
import { date, money, qty, todayISO } from '../../format'
import { t } from '../../i18n'
import { StockDocForm } from './StockDocs'
import { DateInput } from '../../components/Inputs'

/** Guruhlar daraxti → chekinishli ro'yxat */
export function groupOptions(groups) {
  const kids = {}
  groups.forEach((g) => { (kids[g.parent || 0] = kids[g.parent || 0] || []).push(g) })
  const out = []
  const walk = (pid, depth) => (kids[pid] || []).sort((x, y) => x.name.localeCompare(y.name)).forEach((g) => {
    out.push([g.id, '   '.repeat(depth) + g.name])
    walk(g.id, depth + 1)
  })
  walk(0, 0)
  return out
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== '' && x != null && x !== false))
const iso = (d) => d.toISOString().slice(0, 10)
function periodOf(kind) {
  const now = new Date()
  const to = iso(now)
  if (kind === 'day') return { date_from: to, date_to: to }
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { date_from: iso(d), date_to: to } }
  if (kind === 'month') return { date_from: to.slice(0, 8) + '01', date_to: to }
  if (kind === 'quarter') { const m = Math.floor(now.getMonth() / 3) * 3; return { date_from: `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`, date_to: to } }
  return { date_from: `${now.getFullYear()}-01-01`, date_to: to }
}

const Q = ({ v, sign }) => (Number(v) ? (sign || '') + qty(v) : <span className="muted">—</span>)
const S = ({ v, c }) => (Number(v) ? money(v, c) : <span className="muted">—</span>)

export function Turnover() {
  const [f, setF] = useState({ date_from: todayISO().slice(0, 8) + '01', date_to: todayISO(), warehouse: '', group: '', search: '', moved: false })
  const [sel, setSel] = useState(null)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const warehouses = useFetch('/warehouse/warehouses/')
  const groups = useFetch('/warehouse/groups/')
  const params = clean({ ...f, moved: f.moved ? 1 : '' })
  const { data, error } = useFetch('/warehouse/turnover/', params)
  const { rows: pageRows, pager } = usePager(data?.rows, 50, JSON.stringify(f))

  return (
    <>
      <div className="filter-panel card">
        <div className="turn-filter">
          <label>{t('Davr')}
            <div className="period-links">
              {[['day', t('bugun')], ['week', t('hafta')], ['month', t('oy')], ['quarter', t('chorak')], ['year', t('yil')]].map(([k, l], i) => (
                <span key={k}>{i > 0 && '·'}<button type="button" className="link-btn" onClick={() => setF((x) => ({ ...x, ...periodOf(k) }))}>{l}</button></span>
              ))}
            </div>
            <div className="inline-pick">
              <DateInput value={f.date_from} onChange={(e) => set('date_from', e.target.value)} />—
              <DateInput value={f.date_to} onChange={(e) => set('date_to', e.target.value)} />
            </div>
          </label>
          <label>{t('Ombor')}
            <select value={f.warehouse} onChange={(e) => set('warehouse', e.target.value)}>
              <option value="">{t('Hammasi')}</option>
              {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>{t('Guruh')}
            <select value={f.group} onChange={(e) => set('group', e.target.value)}>
              <option value="">{t('Hammasi')}</option>
              <option value="none">{t('Guruhsiz')}</option>
              {groupOptions(groups.data || []).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <label>{t('Qidiruv')}
            <input value={f.search} placeholder={t('Nomi, kodi, artikul yoki shtrix-kod')} onChange={(e) => set('search', e.target.value)} />
          </label>
          <label className="check turn-moved"><input type="checkbox" checked={f.moved} onChange={(e) => set('moved', e.target.checked)} /> {t('Faqat davrda harakatlanganlar')}</label>
        </div>
      </div>

      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t turn-t">
            <thead>
              <tr>
                <th rowSpan={2}>{t('Tovar')}</th><th rowSpan={2}>{t('Birlik')}</th>
                <th colSpan={2} className="grp">{t('Davr boshida')}</th>
                <th colSpan={2} className="grp">{t('Kirim')}</th>
                <th colSpan={2} className="grp">{t('Chiqim')}</th>
                <th colSpan={2} className="grp">{t('Davr oxirida')}</th>
              </tr>
              <tr>
                {[0, 1, 2, 3].map((i) => [
                  <th key={'q' + i} className="num sub grp-l">{t('Soni')}</th>,
                  <th key={'s' + i} className="num sub">{t('Summa')}</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.material} className={'clickable' + (sel === r.material ? ' selected' : '')} onClick={() => setSel(r.material)}>
                  <td>{r.code && <b className="pos-code">{r.code}</b>} {r.name}{r.group_name && <div className="small muted">{r.group_name}</div>}</td>
                  <td className="muted">{t(r.unit)}</td>
                  <td className="num grp-l"><Q v={r.opening} /></td><td className="num"><S v={r.opening_sum} c={r.currency} /></td>
                  <td className="num grp-l green"><Q v={r.income} sign="+" /></td><td className="num green"><S v={r.income_sum} c={r.currency} /></td>
                  <td className="num grp-l red"><Q v={r.outcome} sign="−" /></td><td className="num red"><S v={r.outcome_sum} c={r.currency} /></td>
                  <td className="num grp-l bold"><Q v={r.closing} /></td><td className="num bold"><S v={r.closing_sum} c={r.currency} /></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={10} className="empty">{t("Davrda harakat yo'q")}</td></tr>}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}>{t('Jami')}</td>
                  <td className="grp-l" /><td className="num"><MoneyBag bag={data.totals.opening} /></td>
                  <td className="grp-l" /><td className="num green"><MoneyBag bag={data.totals.income} /></td>
                  <td className="grp-l" /><td className="num red"><MoneyBag bag={data.totals.outcome} /></td>
                  <td className="grp-l" /><td className="num bold"><MoneyBag bag={data.totals.closing} /></td>
                </tr>
              </tfoot>
            )}
          </table>
          {pager}
          <p className="hint" style={{ padding: '0 12px 10px' }}>{t("Summa — tannarxda: kirim xarid narxida, chiqim o'sha paytdagi o'rtacha narxda. Qatorni bosing — tovar harakatlari o'ng tomonda ochiladi.")}</p>
        </div>
      )}
      {sel && <MovesPanel material={sel} params={params} onClose={() => setSel(null)} />}
    </>
  )
}

/* O'ng panel: tanlangan tovarning davrdagi harakatlari (MoySklad: Обороты → документы) */
function MovesPanel({ material, params, onClose }) {
  const nav = useNavigate()
  const [stamp, setStamp] = useState(0)
  const [doc, setDoc] = useState(null)
  const { data, error } = useFetch('/warehouse/turnover/moves/', { ...params, material, _s: stamp })
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && !doc && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [doc, onClose])

  const open = (ref) => {
    if (ref.kind === 'doc') setDoc(ref)
    else if (ref.kind === 'sale') nav(`/sales?open=${ref.id}`)
    else if (ref.kind === 'order') nav(`/orders/${ref.id}`)
    else if (ref.kind === 'job') nav('/production')
  }
  const tot = (data?.rows || []).reduce((a, r) => [a[0] + Number(r.income), a[1] + Number(r.outcome)], [0, 0])

  return (
    <>
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer turn-drawer">
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>{data ? <>{data.code && <span className="pos-code">{data.code}</span>} {data.name}</> : t('Harakatlar')}</h2>
            {data && <div className="muted small">{t('Harakatlar')} · {date(data.date_from)} — {date(data.date_to)}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label={t('Yopish')}><Icon name="close" size={18} /></button>
        </div>
        {!data ? <Loading error={error} /> : (
          <>
            <div className="turn-sum">
              <div><span>{t('Davr boshida')}</span><b>{qty(data.opening)} {t(data.unit)}</b></div>
              <div><span>{t('Kirim')}</span><b className="green">+{qty(tot[0])}</b></div>
              <div><span>{t('Chiqim')}</span><b className="red">−{qty(tot[1])}</b></div>
              <div><span>{t('Davr oxirida')}</span><b>{qty(data.closing)} {t(data.unit)}</b></div>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Sana')}</th><th>{t('Hujjat')}</th><th>{t('Kontragent')}</th><th>{t('Ombor')}</th><th className="num">{t('Kirim')}</th><th className="num">{t('Chiqim')}</th><th className="num">{t('Narx')}</th><th className="num">{t('Qoldiq')}</th></tr></thead>
                <tbody>
                  <tr className="muted"><td>{date(data.date_from)}</td><td colSpan={6}>{t('Davr boshidagi qoldiq')}</td><td className="num">{qty(data.opening)}</td></tr>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{date(r.date)}</td>
                      <td>
                        {r.ref.kind ? <button type="button" className="link-btn" onClick={() => open(r.ref)}>{t(r.ref.label.split(' №')[0])} №{r.ref.label.split(' №')[1]}</button> : t(r.ref.label)}
                        {r.note && r.note !== r.ref.label && <div className="small muted">{r.note}</div>}
                      </td>
                      <td className="small">{r.counterparty || '—'}</td>
                      <td className="small">{r.warehouse}</td>
                      <td className="num green">{Number(r.income) ? '+' + qty(r.income) : ''}</td>
                      <td className="num red">{Number(r.outcome) ? '−' + qty(r.outcome) : ''}</td>
                      <td className="num small">{money(r.price, r.currency)}</td>
                      <td className="num bold">{qty(r.balance)}</td>
                    </tr>
                  ))}
                  {!data.rows.length && <tr><td colSpan={8} className="empty">{t("Davrda harakat yo'q")}</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside>
    </div>
    {doc && <StockDocForm id={doc.id} type={doc.doc_type} onClose={() => setDoc(null)} onSaved={() => { setDoc(null); setStamp((s) => s + 1) }} />}
    </>
  )
}

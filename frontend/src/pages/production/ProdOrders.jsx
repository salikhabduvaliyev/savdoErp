// Ishlab chiqarish buyurtmalari (MoySklad "Заказы на производство"): forma, karta, ishni boshlash, tarix
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { SearchSelect, usePager } from '../../components/Controls'
import { cleanNum, DocField, DocFooter, DocPage, DocTitle, newKey } from '../../components/DocEditor'
import Icon, { IconBtn } from '../../components/Icon'
import { Badge, Loading, Modal, Progress, toast, useFetch } from '../../components/ui'
import { date, qty, todayISO } from '../../format'
import { t as tr } from '../../i18n'
import { JobCard } from './Jobs'
import { confirmDialog } from '../../components/Confirm'
import { DateInput, NumInput } from '../../components/Inputs'

const STATUSES = [['new', tr('Yangi')], ['in_progress', tr('Jarayonda')], ['done', tr('Bajarildi')], ['cancelled', tr('Bekor qilindi')]]
const BADGE = { new: 'new', in_progress: 'in_production', done: 'done', cancelled: 'cancelled' }

/* ------------------------------------------------------------ texkarta qidiruvi (pozitsiya qo'shish) */
function TechcardSearch({ techcards, onPick }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const n = q.trim().toLowerCase()
  const list = n ? techcards.filter((x) => `${x.product_name} ${x.name}`.toLowerCase().includes(n)).slice(0, 15) : []
  const pick = (x) => { onPick(x); setQ(''); setOpen(false) }
  return (
    <div className="psearch">
      <Icon name="search" size={16} className="psearch-ic" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); if (list[active]) pick(list[active]) }
        }}
        placeholder={tr("Mahsulot qo'shish: nomi yoki texkarta…")} />
      {open && n && (
        <div className="psearch-list">
          {list.map((x, i) => (
            <button type="button" key={x.id} className={'psearch-item' + (i === active ? ' active' : '')} onMouseDown={() => pick(x)} onMouseEnter={() => setActive(i)}>
              <span className="code">{tr('texkarta')}</span>
              <span className="name">{x.product_name}<small>{x.name}{x.process_name ? ` · ${x.process_name}` : ''}</small></span>
              <span className="stock">{x.cost ? `≈ ${qty(x.cost.total)} ${x.cost.currency === 'UZS' ? tr("so'm") : x.cost.currency}` : ''}</span>
            </button>
          ))}
          {!list.length && <div className="psearch-empty">{tr("Topilmadi — avval mahsulotga texkarta yarating")}</div>}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ forma */
function ProdOrderForm({ item, onClose, onSaved }) {
  const tcs = useFetch('/production/techcards/', { is_active: true })
  const [v, setV] = useState({ date: item?.date || todayISO(), plan_date: item?.plan_date || '', note: item?.note || '' })
  const [lines, setLines] = useState(() => (item?.items || []).map((i) => ({ key: newKey(), techcard: i.techcard, name: i.product_name, tc: i.techcard_name, unit: i.unit, qty: cleanNum(i.qty) })))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const add = (x) => setLines((ls) => {
    const same = ls.find((l) => l.techcard === x.id)
    if (same) return ls.map((l) => (l === same ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l))
    return [...ls, { key: newKey(), techcard: x.id, name: x.product_name, tc: x.name, unit: x.product_unit, qty: '1' }]
  })
  const save = async () => {
    setBusy(true)
    setError(null)
    const payload = { ...v, plan_date: v.plan_date || null, items: lines.map((l) => ({ techcard: l.techcard, qty: l.qty || 0 })) }
    try {
      const { data } = item ? await api.patch(`/production/orders/${item.id}/`, payload) : await api.post('/production/orders/', payload)
      onSaved(data)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return (
    <DocPage onClose={onClose} toolbar={<>
      <button className="btn primary" disabled={busy || !lines.length} onClick={save}><Icon name="save" size={16} /> {tr('Saqlash')}</button>
      <button className="btn" onClick={onClose}>{tr('Yopish')}</button>
    </>}>
      <DocTitle label="Ishlab chiqarish buyurtmasi" number={item?.number} date={v.date} onDate={(d) => setV({ ...v, date: d })} />
      {error && <div className="error">{error}</div>}
      <div className="doc-grid">
        <div><DocField label="Tayyor bo'lish sanasi"><DateInput value={v.plan_date} onChange={(e) => setV({ ...v, plan_date: e.target.value })} /></DocField></div>
        <div>{item?.client_order_number && <DocField label="Mijoz buyurtmasi"><input readOnly className="muted-input" value={`№${item.client_order_number}`} /></DocField>}</div>
        <div />
      </div>
      <div className="doc-tabs"><span className="active">{tr('Mahsulotlar')}</span></div>
      <div className="positions">
        <div className="table-wrap">
          <table className="t positions-t">
            <thead><tr><th style={{ width: 36 }}>№</th><th>{tr('Mahsulot')}</th><th>{tr('Texkarta')}</th><th className="num" style={{ width: 130 }}>{tr('Miqdor')}</th><th style={{ width: 70 }}>{tr('Birlik')}</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td><td className="bold">{l.name}</td><td className="muted">{l.tc}</td>
                  <td className="num"><NumInput className="cell num" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td className="muted small">{tr(l.unit || '')}</td>
                  <td className="num"><IconBtn icon="delete" danger title="O'chirish" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={6} className="empty">{tr("Mahsulot yo'q — pastdagi qidiruv orqali qo'shing")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="positions-add"><TechcardSearch techcards={tcs.data || []} onPick={add} /></div>
      </div>
      <DocFooter comment={v.note} onComment={(note) => setV({ ...v, note })} rows={[['Mahsulotlar', lines.length], ['Jami miqdor', qty(lines.reduce((a, l) => a + Number(l.qty || 0), 0)), true]]} />
    </DocPage>
  )
}

/* ------------------------------------------------------------ ishni boshlash modali */
function StartModal({ po, onClose, onStarted }) {
  const whs = useFetch('/warehouse/warehouses/')
  const def = whs.data?.[0]?.id || ''
  const [w, setW] = useState({ materials_warehouse: '', products_warehouse: '' })
  const mw = w.materials_warehouse || def
  const pw = w.products_warehouse || def
  const byStages = !po.items.length && (po.stages || []).length > 0
  const req = useFetch(mw && !byStages ? `/production/orders/${po.id}/requirements/` : null, { warehouse: mw })
  const short = (req.data || []).filter((r) => Number(r.shortage) > 0)
  const [busy, setBusy] = useState(false)
  const start = async () => {
    if (short.length && !await confirmDialog(tr("Material yetarli emas. Shunda ham boshlansinmi? Ombordagi qoldiq minusga ketadi."))) return
    setBusy(true)
    try {
      const { data } = await api.post(`/production/orders/${po.id}/create_jobs/`, byStages ? {} : { materials_warehouse: mw, products_warehouse: pw, allow_negative: short.length > 0 })
      toast(tr('Ish boshlandi: {n} ta topshiriq', { n: data.created }))
      onStarted()
    } catch (e) { toast(errorText(e), true) } finally { setBusy(false) }
  }
  const whOpts = (whs.data || []).map((x) => ({ value: x.id, label: x.name }))
  if (byStages) {
    return (
      <Modal title={tr('Ishni boshlash — buyurtma №{n}', { n: po.number })} onClose={onClose} wide dialog>
        <div className="muted small" style={{ marginBottom: 8 }}>
          {po.process_name && <>{tr('Texjarayon')}: <b>{po.process_name}</b> · </>}
          {po.client_order_number && <>{tr('Mijoz buyurtmasi')}: №{po.client_order_number}</>}
        </div>
        <StagesTable stages={po.stages} />
        <div className="hint" style={{ marginTop: 8 }}>{tr("Boshlansa, bosqichlar buyurtma raqami bilan bo'limlarga (Bo'lim ekrani) tushadi.")}</div>
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>{tr('Bekor')}</button>
          <button className="btn success" disabled={busy} onClick={start}><Icon name="check" size={16} /> {tr('Ishni boshlash')}</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={tr('Ishni boshlash — buyurtma №{n}', { n: po.number })} onClose={onClose} wide dialog>
      <div className="start-grid">
        <div>
          <div className="muted small">{tr('Mahsulotlar')}</div>
          {po.items.map((i) => <div key={i.id} className="bold">{i.product_name} × {qty(i.qty)} {tr(i.unit)}</div>)}
          {po.client_order_number && <div className="small muted" style={{ marginTop: 6 }}>{tr('Mijoz buyurtmasi')}: №{po.client_order_number}</div>}
        </div>
        <label>{tr('Materiallar qaysi ombordan')}<SearchSelect value={mw} onChange={(v) => setW({ ...w, materials_warehouse: v })} options={whOpts} /></label>
        <label>{tr('Tayyor mahsulot qaysi omborga')}<SearchSelect value={pw} onChange={(v) => setW({ ...w, products_warehouse: v })} options={whOpts} /></label>
      </div>
      <h3 style={{ margin: '14px 0 8px' }}>{tr('Material ehtiyoji')}</h3>
      {!req.data ? <Loading error={req.error} /> : (
        <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="t compact">
            <thead><tr><th>{tr('Material')}</th><th className="num">{tr('Kerak')}</th><th className="num">{tr('Omborda')}</th><th className="num">{tr('Yetishmaydi')}</th></tr></thead>
            <tbody>
              {req.data.map((r) => (
                <tr key={r.material} className={Number(r.shortage) > 0 ? 'row-danger' : ''}>
                  <td>{r.name}</td><td className="num">{qty(r.need)} {tr(r.unit)}</td><td className="num">{qty(r.available)}</td>
                  <td className={'num ' + (Number(r.shortage) > 0 ? 'red bold' : 'green')}>{Number(r.shortage) > 0 ? qty(r.shortage) : '✓'}</td>
                </tr>
              ))}
              {!req.data.length && <tr><td colSpan={4} className="empty">{tr("Texkartalarda material yo'q")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {short.length > 0
        ? <div className="warn-box"><Icon name="filter" size={16} /> {tr('{n} ta material yetishmaydi. Boshlasangiz, ombordagi qoldiq minusga ketadi.', { n: short.length })}</div>
        : req.data && <div className="ok-box">✓ {tr("Barcha materiallar yetarli")}</div>}
      <div className="form-actions">
        <button className="btn ghost" onClick={onClose}>{tr('Bekor')}</button>
        <button className={'btn ' + (short.length ? 'danger' : 'success')} disabled={busy || !pw || !req.data} onClick={start}>
          <Icon name="check" size={16} /> {short.length ? tr('Shunda ham boshlash') : tr('Ishni boshlash')}
        </button>
      </div>
    </Modal>
  )
}

function StagesTable({ stages, job }) {
  return (
    <div className="table-wrap">
      <table className="t compact">
        <thead><tr><th>№</th><th>{tr('Bosqich')}</th><th>{tr("Bo'lim")}</th><th>{tr('Xodim')}</th><th className="num">{tr('Reja')}</th>{job && <th className="num">{tr('Bajarildi')}</th>}</tr></thead>
        <tbody>
          {stages.map((s, i) => {
            const t = job?.stages?.[i]
            return (
              <tr key={s.id}>
                <td className="muted">{i + 1}</td><td className="bold">{s.operation_name}</td><td className="small">{s.department || '—'}</td>
                <td className="small">{s.employee || <span className="red">{tr('biriktirilmagan')}</span>}</td>
                <td className="num">{qty(s.qty)} {tr(s.unit)}</td>
                {job && <td className={'num' + (t?.status === 'done' ? ' green' : '')}>{t ? `${qty(t.done_qty)} ${tr(s.unit)}` : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------ tarix */
export function HistoryList({ entity, id }) {
  const { data } = useFetch(id ? '/core/audit/' : null, { entity, entity_id: id })
  if (!data?.length) return <div className="muted small">{tr("Tarix yo'q")}</div>
  return (
    <ul className="history">
      {data.map((h) => (
        <li key={h.id}>
          <span className="h-time">{new Date(h.created_at).toLocaleString()}</span>
          <b>{h.user_name || '—'}</b> · <Badge kind={h.action === 'delete' ? 'cancelled' : h.action === 'create' ? 'ok' : 'confirmed'}>{tr(h.action_display)}</Badge>
          {Object.keys(h.changes || {}).length > 0 && (
            <div className="h-changes">{Object.entries(h.changes).map(([k, [a, b]]) => <div key={k}>{tr(k)}: <s>{String(a ?? '—')}</s> → <b>{String(b ?? '—')}</b></div>)}</div>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------ karta */
function ProdOrderCard({ id, onClose, onChanged }) {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data: po, error } = useFetch(`/production/orders/${id}/`, { stamp })
  const jobs = useFetch('/production/jobs/', { production_order: id, stamp })
  const [edit, setEdit] = useState(false)
  const [start, setStart] = useState(false)
  const [openJob, setOpenJob] = useState(null)
  if (!po) return <DocPage onClose={onClose} toolbar={<button className="btn" onClick={onClose}>{tr('Yopish')}</button>}><Loading error={error} /></DocPage>
  const refresh = () => { setStamp((s) => s + 1); onChanged() }
  const editable = canEdit(user, 'production')
  const started = (jobs.data || []).some((j) => j.status !== 'cancelled')
  const cancel = async () => {
    if (!await confirmDialog(tr('Buyurtma bekor qilinsinmi?'))) return
    try { await api.post(`/production/orders/${id}/cancel/`); refresh() } catch (e) { toast(errorText(e), true) }
  }
  const remove = async () => {
    if (!await confirmDialog(tr("Buyurtma o'chirilsinmi? Boshlanmagan topshiriqlar ham o'chiriladi."))) return
    try { await api.delete(`/production/orders/${id}/`); toast(tr("O'chirildi")); onChanged(); onClose() } catch (e) { toast(errorText(e), true) }
  }
  return (
    <DocPage onClose={onClose} toolbar={<>
      {editable && !['done', 'cancelled'].includes(po.status) && !started && (
        <button className="btn success" onClick={() => setStart(true)}><Icon name="check" size={16} /> {tr('Ishni boshlash')}</button>
      )}
      {editable && !['done', 'cancelled'].includes(po.status) && po.items.length > 0 && (
        <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={16} /> {tr('Tahrirlash')}</button>
      )}
      <button className="btn" onClick={onClose}>{tr('Yopish')}</button>
      <span className="grow" />
      {editable && !['done', 'cancelled'].includes(po.status) && <button className="btn" onClick={cancel}>{tr('Bekor qilish')}</button>}
      {canDelete(user, 'production') && <button className="icon-act danger" title={tr("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
    </>}>
      <DocTitle label="Ishlab chiqarish buyurtmasi" number={po.number} date={po.date}>
        <Badge kind={BADGE[po.status]}>{tr(po.status_display)}</Badge>
        {po.client_order && <Link to={`/orders/${po.client_order}`} className="small">{tr('Mijoz buyurtmasi')} №{po.client_order_number}</Link>}
        {po.plan_date && <span className="muted small">{tr('Tayyor bo\'lishi')}: {date(po.plan_date)}</span>}
      </DocTitle>

      {(po.stages || []).length > 0 && (() => {
        const job = (jobs.data || []).find((j) => j.status !== 'cancelled')
        return (
          <div className="card po-item" style={{ marginBottom: 12 }}>
            <div className="po-item-head">
              <div><div className="bold">{po.process_name || tr('Bosqichlar')}</div><div className="muted small">{tr("Mahsulotsiz buyurtma — texjarayon bo'yicha")}</div></div>
              {job && <button className="link-btn small" onClick={() => setOpenJob(job.id)}>{tr('Topshiriq')} №{job.number}</button>}
            </div>
            <StagesTable stages={po.stages} job={job} />
            {job ? <div className="po-item-foot"><Progress value={job.progress} /></div> : <div className="muted small" style={{ marginTop: 6 }}>{tr("Ish hali boshlanmagan")}</div>}
          </div>
        )
      })()}
      <div className="po-items">
        {po.items.map((i) => {
          const job = (jobs.data || []).find((j) => j.techcard === i.techcard && j.status !== 'cancelled')
          const cur = job?.stages?.find((s) => s.status !== 'done')
          return (
            <div key={i.id} className="card po-item">
              <div className="po-item-head">
                <div><div className="bold">{i.product_name}</div><div className="muted small">{i.techcard_name}</div></div>
                <div className="num"><b>{qty(i.produced)}</b> / {qty(i.qty)} {tr(i.unit)}</div>
              </div>
              {job ? (
                <>
                  <div className="stage-flow">
                    {job.stages.map((s) => (
                      <div key={s.id} className={'stage-chip ' + s.status + (cur?.id === s.id ? ' current' : '')} title={`${s.department}: ${qty(s.done_qty)} / ${qty(s.plan_qty)}`}>
                        <span>{s.status === 'done' ? '✓' : cur?.id === s.id ? '●' : '○'}</span> {s.department}
                        <small>{qty(s.done_qty)}/{qty(s.plan_qty)}</small>
                      </div>
                    ))}
                  </div>
                  <div className="po-item-foot">
                    <Progress value={job.progress} />
                    <span className="small muted">{cur ? tr('Hozir: {d}', { d: cur.department }) : tr('Tayyor')}</span>
                    <button className="link-btn small" onClick={() => setOpenJob(job.id)}>{tr('Topshiriq')} №{job.number}</button>
                  </div>
                </>
              ) : <div className="muted small">{tr("Ish hali boshlanmagan")}</div>}
            </div>
          )
        })}
      </div>

      {po.note && <p className="hint">{po.note}</p>}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ marginBottom: 8 }}>{tr('Tarix')}</h3>
        <HistoryList entity="production_order" id={po.id} key={stamp} />
      </div>

      {edit && <ProdOrderForm item={po} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); toast(tr('Saqlandi')) }} />}
      {start && <StartModal po={po} onClose={() => setStart(false)} onStarted={() => { setStart(false); refresh() }} />}
      {openJob && <JobCard id={openJob} onClose={() => setOpenJob(null)} onChanged={refresh} />}
    </DocPage>
  )
}

/* ------------------------------------------------------------ ro'yxat */
export function ProdOrdersTab() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [stamp, setStamp] = useState(0)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const { data, error } = useFetch('/production/orders/', { status: status || undefined, stamp })
  const rows = useMemo(() => {
    const n = search.trim().toLowerCase()
    return (data || []).filter((po) => !n || String(po.number).includes(n) || po.items.some((i) => i.product_name.toLowerCase().includes(n)) || (po.process_name || '').toLowerCase().includes(n))
  }, [data, search])
  const { rows: pageRows, pager } = usePager(rows, 50, status + search)
  const open = params.get('po')
  const setOpen = (v) => { const p = new URLSearchParams(params); if (v) p.set('po', v); else p.delete('po'); setParams(p) }
  return (
    <>
      <div className="page-head">
        <h2 style={{ margin: 0 }}>{tr('Ishlab chiqarish buyurtmalari')}</h2>
        {canCreate(user, 'production') && <button className="btn primary" onClick={() => setOpen('new')}><Icon name="plus" size={16} /> {tr('Buyurtma')}</button>}
        <span className="grow" />
        <select className="chip" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{tr('Holat: hammasi')}</option>
          {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="psearch" style={{ maxWidth: 280, minWidth: 200 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={tr('Raqam yoki mahsulot')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>№</th><th>{tr('Sana')}</th><th>{tr('Mahsulotlar')}</th><th>{tr('Mijoz buyurtmasi')}</th><th>{tr('Tayyor bo\'lishi')}</th><th className="num">{tr('Topshiriqlar')}</th><th>{tr('Holat')}</th></tr></thead>
            <tbody>
              {pageRows.map((po) => (
                <tr key={po.id} className="clickable" onClick={() => setOpen(String(po.id))}>
                  <td><span className="link-like">{po.number}</span></td><td>{date(po.date)}</td>
                  <td>{po.items.length ? po.items.map((i) => `${i.product_name} × ${qty(i.qty)}`).join(', ') : <>{po.process_name || tr('Texjarayon')} <span className="small muted">({(po.stages || []).length} {tr('bosqich')})</span></>}</td>
                  <td>{po.client_order_number ? `№${po.client_order_number}` : '—'}</td>
                  <td>{date(po.plan_date)}</td><td className="num">{po.jobs_count}</td>
                  <td><Badge kind={BADGE[po.status]}>{tr(po.status_display)}</Badge></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="empty">{tr("Buyurtmalar yo'q")}</td></tr>}
            </tbody>
          </table>
          {pager}
        </div>
      )}
      {open === 'new' && <ProdOrderForm onClose={() => setOpen(null)} onSaved={(po) => { setStamp((s) => s + 1); setOpen(String(po.id)) }} />}
      {open && open !== 'new' && <ProdOrderCard key={open} id={open} onClose={() => setOpen(null)} onChanged={() => setStamp((s) => s + 1)} />}
    </>
  )
}

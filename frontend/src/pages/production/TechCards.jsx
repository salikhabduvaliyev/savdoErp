import { useState } from 'react'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import EntityForm from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, toast, useFetch } from '../../components/ui'
import { money, num, qty } from '../../format'
import { t } from '../../i18n'
import { IconBtn } from '../../components/Icon'
import { SearchSelect } from '../../components/Controls'

const UNITS = [['pcs', t("dona")], ['m', 'm'], ['m2', 'm²'], ['kg', t("kg")], ['set', t("to'plam")]]
const CUR = [['UZS', t("so'm")], ['USD', 'USD']]

/* ------------------------------------------------------------ texkarta */
function TechCardForm({ item, onClose, onSaved }) {
  const products = useFetch('/warehouse/products/', { type: 'product,goods', is_active: true })
  const materials = useFetch('/warehouse/products/', { type: 'raw,goods,product', is_active: true })
  const processes = useFetch('/production/processes/')
  const [v, setV] = useState(() => ({ name: item?.name || '', product: item?.product || '', output_qty: item?.output_qty || '1',
    process: item?.process || '', note: item?.note || '', is_active: item?.is_active ?? true }))
  const [rows, setRows] = useState(() => item?.materials?.map((m) => ({ key: m.id, material: m.material, qty: m.qty, operation: m.operation || '' }))
    || [{ key: 1, material: '', qty: '', operation: '' }])
  const [error, setError] = useState(null)
  const proc = (processes.data || []).find((p) => String(p.id) === String(v.process))
  const prod = (products.data || []).find((p) => String(p.id) === String(v.product))
  const matById = Object.fromEntries((materials.data || []).map((m) => [String(m.id), m]))

  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...v, process: v.process || null, name: v.name || prod?.name || '',
      materials: rows.filter((r) => r.material && r.qty).map((r) => ({ material: r.material, qty: r.qty, operation: r.operation || null })) }
    try {
      item ? await api.patch(`/production/techcards/${item.id}/`, payload) : await api.post('/production/techcards/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  const setRow = (key, patch) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <Modal title={item ? `Texkarta: ${item.name}` : 'Yangi texkarta'} onClose={onClose} wide>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form three">
          <Field label={t("Mahsulot (natija)")}>
            <SearchSelect value={v.product} onChange={(id) => setV({ ...v, product: id })} placeholder={t("— tanlang —")}
              options={(products.data || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} />
          </Field>
          <Field label={t('Chiqish miqdori') + (prod ? `, ${t(prod.unit_display)}` : '')}><input type="number" step="any" min="0" value={v.output_qty} onChange={(e) => setV({ ...v, output_qty: e.target.value })} required /></Field>
          <Field label={t("Texjarayon (bosqichlar)")}>
            <SearchSelect value={v.process} onChange={(id) => setV({ ...v, process: id })} empty="—"
              options={(processes.data || []).map((p) => ({ value: p.id, label: p.name, sub: t('{n} bosqich', { n: p.stages.length }) }))} />
          </Field>
          <Field label={t("Texkarta nomi (bo'sh — mahsulot nomi)")}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label={t("Izoh")}><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <div><label className="check" style={{ marginTop: 26 }}><input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> {t("Faol")}</label></div>
        </div>
        {proc && <p className="hint">Bosqichlar: {proc.stages.map((s) => s.operation_name).join(' → ')}</p>}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="t">
            <thead><tr><th style={{ width: '45%' }}>{t("Material")}</th><th className="num">Me'yor ({qty(v.output_qty || 1)} {prod?.unit_display || 'birlik'} uchun)</th><th>{t("Qaysi bosqichda")}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <SearchSelect value={r.material} onChange={(id) => setRow(r.key, { material: id })} placeholder={t("— material —")}
                      options={(materials.data || []).map((m) => ({ value: m.id, label: m.name, sub: t(m.unit_display) }))} />
                  </td>
                  <td className="num"><input className="cell" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} /> {matById[String(r.material)]?.unit_display}</td>
                  <td>
                    <select className="cell" value={r.operation} onChange={(e) => setRow(r.key, { operation: e.target.value })}>
                      <option value="">{t("Birinchi bosqichda")}</option>
                      {(proc?.stages || []).map((s) => <option key={s.id} value={s.operation}>{s.operation_name}</option>)}
                    </select>
                  </td>
                  <td className="num"><IconBtn icon="delete" danger title="O\'chirish" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
            <button type="button" className="btn small" onClick={() => setRows([...rows, { key: Math.random(), material: '', qty: '', operation: '' }])}>{t("+ Material")}</button>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

export function TechCardsTab() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [search, setSearch] = useState('')
  const { data, error } = useFetch('/production/techcards/', { search: search || undefined, stamp })
  const [form, setForm] = useState(null)
  const remove = async (tc) => {
    if (!window.confirm(`"${tc.name}" o'chirilsinmi?`)) return
    try { await api.delete(`/production/techcards/${tc.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          {canCreate(user, 'production') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Texkarta")}</button>}
          <input placeholder={t("Nomi yoki mahsulot…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>{t("Texkarta")}</th><th>{t("Mahsulot")}</th><th className="num">{t("Chiqish")}</th><th>{t("Texjarayon")}</th><th className="num">{t("Materiallar")}</th><th className="num">{t("Rejaviy tannarx / birlik")}</th><th /></tr></thead>
            <tbody>
              {data.map((tc) => (
                <tr key={tc.id} className={canEdit(user, 'production') ? 'clickable' : ''} onClick={() => canEdit(user, 'production') && setForm({ item: tc })}>
                  <td className="bold">{tc.name}{!tc.is_active && <span className="muted small"> {t("(nofaol)")}</span>}</td>
                  <td>{tc.product_name}</td>
                  <td className="num">{qty(tc.output_qty)} {tc.product_unit}</td>
                  <td>{tc.process_name || <span className="red small">{t("biriktirilmagan")}</span>}</td>
                  <td className="num">{tc.materials.length}</td>
                  <td className="num bold">{tc.cost ? money(tc.cost.total, tc.cost.currency) : '—'}{tc.cost && <div className="small muted">mat. {num(tc.cost.materials)} + ish {num(tc.cost.labor)}</div>}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'production') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(tc)} />}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={7} className="empty">{t("Texkartalar yo'q. Avval \"Bosqichlar\" va \"Texjarayonlar\"ni to'ldiring.")}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="legend"><span>{t("Texkarta — mahsulotni ishlab chiqarish retsepti: qaysi materialdan qancha va qaysi bosqichda sarflanadi.")}</span></div>
      {form && <TechCardForm item={form.item} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Texkarta saqlandi') }} />}
    </>
  )
}

/* ------------------------------------------------------------ texjarayon */
function ProcessForm({ item, onClose, onSaved }) {
  const ops = useFetch('/production/operations/')
  const [v, setV] = useState({ name: item?.name || '', description: item?.description || '', is_active: item?.is_active ?? true })
  const [stages, setStages] = useState(() => item?.stages?.map((s) => ({ key: s.id, operation: s.operation })) || [])
  const [add, setAdd] = useState('')
  const [error, setError] = useState(null)
  const opById = Object.fromEntries((ops.data || []).map((o) => [String(o.id), o]))
  const move = (i, d) => {
    const next = [...stages]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setStages(next)
  }
  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...v, stages: stages.map((s) => ({ operation: s.operation })) }
    try {
      item ? await api.patch(`/production/processes/${item.id}/`, payload) : await api.post('/production/processes/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={item ? `Texjarayon: ${item.name}` : 'Yangi texjarayon'} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form">
          <Field label={t("Nomi")} full><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required autoFocus /></Field>
          <Field label={t("Tavsif")} full><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        </div>
        <div className="section-title">{t("Bosqichlar ketma-ketligi")}</div>
        <ol style={{ paddingLeft: 22, margin: '8px 0' }}>
          {stages.map((s, i) => (
            <li key={s.key} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ flex: 1 }}>{opById[String(s.operation)]?.name || '…'} <span className="muted small">· {opById[String(s.operation)]?.department_name}</span></b>
                <button type="button" className="btn small ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="btn small ghost" onClick={() => move(i, 1)} disabled={i === stages.length - 1}>↓</button>
                <IconBtn icon="delete" danger title="O\'chirish" onClick={() => setStages(stages.filter((x) => x.key !== s.key))} />
              </span>
            </li>
          ))}
        </ol>
        <div className="filters">
          <div style={{ flex: 1 }}><SearchSelect value={add} onChange={(id) => setAdd(id)} placeholder={t("— bosqich qo'shish —")}
            options={(ops.data || []).map((o) => ({ value: o.id, label: o.name, sub: o.department_name }))} /></div>
          <button type="button" className="btn small" disabled={!add} onClick={() => { setStages([...stages, { key: Math.random(), operation: add }]); setAdd('') }}>{t("Qo'shish")}</button>
        </div>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary" disabled={!stages.length}>{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

export function ProcessesTab() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/production/processes/', { stamp })
  const [form, setForm] = useState(null)
  const remove = async (p) => {
    if (!window.confirm(`"${p.name}" o'chirilsinmi?`)) return
    try { await api.delete(`/production/processes/${p.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="table-wrap">
        <div className="table-toolbar">{canCreate(user, 'production') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Texjarayon")}</button>}</div>
        <table className="t">
          <thead><tr><th>{t("Nomi")}</th><th>{t("Bosqichlar")}</th><th /></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => canEdit(user, 'production') && setForm({ item: p })}>
                <td className="bold">{p.name}{p.description && <div className="small muted">{p.description}</div>}</td>
                <td>{p.stages.map((s, i) => <span key={s.id}>{i > 0 && <span className="muted"> → </span>}<Badge kind="draft">{s.operation_name}</Badge></span>)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'production') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(p)} />}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={3} className="empty">{t("Texjarayonlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      {form && <ProcessForm item={form.item} onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />}
    </>
  )
}

/* ------------------------------------------------------------ bosqichlar */
export function StagesTab() {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/production/operations/', { stamp })
  const deps = useFetch('/production/departments/', { stamp })
  const [form, setForm] = useState(null)
  const [depForm, setDepForm] = useState(null)
  const remove = async (o) => {
    if (!window.confirm(`"${o.name}" o'chirilsinmi?`)) return
    try { await api.delete(`/production/operations/${o.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!data || !deps.data) return <Loading error={error || deps.error} />
  return (
    <>
      <div className="table-wrap">
        <div className="table-toolbar">
          {canCreate(user, 'production') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Bosqich")}</button>}
          {canCreate(user, 'production') && <button className="btn small" onClick={() => setDepForm({ item: null })}>{t("+ Bo'lim (ijrochi)")}</button>}
        </div>
        <table className="t">
          <thead><tr><th>{t("Bosqich")}</th><th>{t("Bo'lim (ijrochi)")}</th><th>{t("Birlik")}</th><th className="num">{t("Ishbay stavka")}</th><th className="num">{t("Xizmat narxi (smeta)")}</th><th /></tr></thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => canEdit(user, 'production') && setForm({ item: o })}>
                <td className="bold">{o.name}{o.description && <div className="small muted">{o.description}</div>}</td>
                <td>{o.department_name}</td>
                <td>{o.unit_display}</td>
                <td className="num">{money(o.piece_rate, 'UZS')}</td>
                <td className="num">{money(o.default_rate, o.rate_currency)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{canDelete(user, 'production') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(o)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{t("Bosqich — ishlab chiqarishning bitta qadami. Ishbay stavka bajarilgan har birlik uchun ijrochiga hisoblanadi.")}</span></div>
      {form && (
        <EntityForm title={form.item ? form.item.name : 'Yangi bosqich'} url="/production/operations/" item={form.item}
          fields={[
            { name: 'name', label: t("Nomi"), required: true },
            { name: 'department', label: t("Bo'lim (ijrochi)"), type: 'select', options: deps.data.map((d) => [d.id, d.name]), required: true },
            { name: 'unit', label: t("O'lchov birligi"), type: 'select', options: UNITS, noEmpty: true },
            { name: 'piece_rate', label: t("Ishbay stavka, so'm / birlik"), type: 'number' },
            { name: 'default_rate', label: t("Xizmat narxi (smeta B blok)"), type: 'number' },
            { name: 'rate_currency', label: t("Xizmat narxi valyutasi"), type: 'select', options: CUR, noEmpty: true },
            { name: 'description', label: t("Tavsif"), full: true },
          ]}
          defaults={{ unit: 'pcs', rate_currency: 'UZS', default_rate: 0, piece_rate: 0 }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />
      )}
      {depForm && (
        <EntityForm title={t("Yangi bo'lim")} url="/production/departments/" item={depForm.item}
          fields={[
            { name: 'name', label: t("Nomi"), required: true },
            { name: 'sequence', label: t("Tartib (10, 20, …)"), type: 'number', required: true },
            { name: 'daily_capacity', label: t("Kunlik sig'im"), type: 'number' },
          ]}
          defaults={{ sequence: (deps.data.length + 1) * 10, daily_capacity: 0 }}
          onClose={() => setDepForm(null)} onSaved={() => { setDepForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />
      )}
    </>
  )
}

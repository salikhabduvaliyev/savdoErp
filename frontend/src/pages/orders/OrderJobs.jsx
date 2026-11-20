// Buyurtma fayllari va mahsulotsiz buyurtmani texjarayon bo'yicha topshiriqqa berish
import { useRef, useState } from 'react'
import api, { errorText } from '../../api'
import { Field, Loading, Modal, toast, useFetch } from '../../components/ui'
import { date, qty } from '../../format'
import { t as tr } from '../../i18n'
import Icon, { IconBtn } from '../../components/Icon'
import { confirmDialog } from '../../components/Confirm'
import { DateInput, NumInput } from '../../components/Inputs'
import { SearchSelect } from '../../components/Controls'

const listOf = (d) => (d ? d.results || d : [])

function fileSize(n) {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ---------------- Fayllar (PDF, Word, chizma ...) ---------------- */
export function OrderFiles({ orderId, editable, onChanged }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch(`/orders/${orderId}/files/`, { stamp })
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const reload = () => { setStamp((s) => s + 1); onChanged?.() }
  const upload = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        await api.post(`/orders/${orderId}/files/`, fd)
      }
      toast(tr('Fayl biriktirildi'))
      reload()
    } catch (e) { toast(errorText(e), true) } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const remove = async (f) => {
    if (!await confirmDialog(tr('"{n}" o\'chirilsinmi?', { n: f.name }))) return
    try { await api.delete(`/orders/${orderId}/files/${f.id}/`); reload() } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <b>{tr('Biriktirilgan fayllar')}</b><span style={{ flex: 1 }} />
        {editable && (
          <>
            <input ref={input} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.dwg,.dxf,.zip"
              onChange={(e) => upload(e.target.files)} />
            <button className="btn primary small" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="plus" size={14} /> {busy ? tr('Yuklanmoqda…') : tr('Fayl biriktirish')}
            </button>
          </>
        )}
      </div>
      <table className="t">
        <thead><tr><th>{tr('Fayl')}</th><th className="num">{tr('Hajmi')}</th><th>{tr('Yukladi')}</th><th>{tr('Sana')}</th><th /></tr></thead>
        <tbody>
          {data.map((f) => (
            <tr key={f.id}>
              <td><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></td>
              <td className="num muted small">{fileSize(f.size)}</td>
              <td className="small">{f.uploaded_by || '—'}</td>
              <td className="small">{date(f.created_at)}</td>
              <td className="num">{editable && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(f)} />}</td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={5} className="empty">{tr("Fayl yo'q — chizma, PDF yoki Word faylni biriktiring; ishlab chiqarishda ishchilarga ham ko'rinadi")}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Mahsulotsiz buyurtma → texjarayon bo'yicha topshiriq ---------------- */
export function ProcessJobModal({ order, onClose, onSaved }) {
  const procs = useFetch('/production/processes/', { is_active: true })
  const ops = useFetch('/production/operations/')
  const opList = listOf(ops.data)
  const opById = (id) => opList.find((o) => String(o.id) === String(id))
  const defQty = Number(order.volume) ? String(Number(order.volume)) : ''
  const [v, setV] = useState({ process: '', plan_start: order.production_date || '', plan_end: order.plan_date || '', note: '' })
  const [rows, setRows] = useState([])
  const [all, setAll] = useState(defQty)
  const [addOp, setAddOp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pickProcess = (id) => {
    const p = listOf(procs.data).find((x) => String(x.id) === String(id))
    setV({ ...v, process: id })
    setRows((p?.stages || []).map((s) => ({ key: `${s.operation}-${s.id}`, operation: s.operation, qty: defQty })))
  }
  const setQty = (i, q) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, qty: q } : r)))
  const fillAll = () => setRows((rs) => rs.map((r) => ({ ...r, qty: all })))
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post(`/orders/${order.id}/to_job/`, {
        process: v.process || null, plan_start: v.plan_start || null, plan_end: v.plan_end || null, note: v.note,
        stages: rows.map((r) => ({ operation: r.operation, qty: r.qty || 0 })),
      })
      toast(tr('Ishlab chiqarish buyurtmasi №{n} yaratildi — ish "Ishlab chiqarish buyurtmalari"da boshlanadi', { n: data.production_order_number }))
      onSaved(data)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  if (!procs.data || !ops.data) return <Modal title={tr('Ishlab chiqarishga berish')} onClose={onClose} dialog wide><Loading error={procs.error || ops.error} /></Modal>

  return (
    <Modal title={tr('Buyurtma №{n} — ishlab chiqarishga berish (texjarayon)', { n: order.number })} onClose={onClose} dialog wide>
      {error && <div className="error">{error}</div>}
      <div className="hint" style={{ marginBottom: 10 }}>
        {tr("Mahsulot (texkarta) kerak emas: texjarayonni tanlang, har bosqichga kv (m²) yoki miqdor kiriting. Zayavka \"Ishlab chiqarish buyurtmalari\"ga tushadi; ish boshlanganda bosqichlar buyurtma raqami bilan bo'limlarga chiqadi, ishbay haq bosqichga biriktirilgan xodimga yoziladi.")}
      </div>
      <div className="form">
        <Field label={tr('Texjarayon')}>
          <SearchSelect value={v.process} onChange={pickProcess} placeholder={tr('Texjarayonni tanlang…')}
            options={listOf(procs.data).map((p) => ({ value: p.id, label: p.name, sub: `${p.stages.length} ${tr('bosqich')}` }))} />
        </Field>
        <Field label={tr('Hammasiga kv (m²)')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <NumInput value={all} onChange={(e) => setAll(e.target.value)} placeholder={defQty || '0'} />
            <button type="button" className="btn small" disabled={!rows.length || !all} onClick={fillAll}>{tr("Qo'llash")}</button>
          </div>
        </Field>
        <Field label={tr('Boshlash (reja)')}><DateInput value={v.plan_start} onChange={(e) => setV({ ...v, plan_start: e.target.value })} /></Field>
        <Field label={tr('Tugatish (reja)')}><DateInput value={v.plan_end} onChange={(e) => setV({ ...v, plan_end: e.target.value })} /></Field>
      </div>

      <h3 style={{ margin: '14px 0 8px' }}>{tr('Bosqichlar')}</h3>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th style={{ width: 40 }}>№</th><th>{tr('Bosqich')}</th><th>{tr("Bo'lim")}</th><th>{tr('Xodim (ishbay haq)')}</th><th className="num">{tr('Kv / miqdor')}</th><th>{tr('Birlik')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const op = opById(r.operation)
              return (
                <tr key={r.key}>
                  <td className="muted">{i + 1}</td>
                  <td className="bold">{op?.name || '—'}</td>
                  <td className="small">{op?.department_name || '—'}</td>
                  <td className="small">{op?.employee_name || <span className="red">{tr('biriktirilmagan')}</span>}</td>
                  <td className="num"><NumInput className="cell num" style={{ width: 110 }} value={r.qty} onChange={(e) => setQty(i, e.target.value)} /></td>
                  <td className="small">{tr(op?.unit_display || '')}</td>
                  <td className="num"><IconBtn icon="delete" danger title="Olib tashlash" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} /></td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={7} className="empty">{tr('Texjarayonni tanlang — bosqichlari shu yerda ko\'rinadi')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="filters" style={{ marginTop: 8 }}>
        <SearchSelect value={addOp} onChange={setAddOp} placeholder={tr('+ bosqich qo\'shish…')}
          options={opList.map((o) => ({ value: o.id, label: o.name, sub: o.employee_name || '' }))} />
        <button type="button" className="btn small" disabled={!addOp} onClick={() => {
          setRows((rs) => [...rs, { key: `${addOp}-${Date.now()}`, operation: addOp, qty: defQty }]); setAddOp('')
        }}>{tr("Qo'shish")}</button>
        <span className="grow" />
        <span className="small muted">{tr('Jami')}: {qty(rows.reduce((a, r) => a + Number(r.qty || 0), 0))}</span>
      </div>
      <Field label={tr('Izoh (ishchilarga)')} full><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onClose}>{tr('Bekor')}</button>
        <button type="button" className="btn primary" disabled={busy || !rows.some((r) => Number(r.qty) > 0)} onClick={submit}>
          <Icon name="production" size={16} /> {busy ? tr('Saqlanmoqda…') : tr('Ishlab chiqarishga berish')}
        </button>
      </div>
    </Modal>
  )
}

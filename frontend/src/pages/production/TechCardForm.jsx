// Texnologik karta (MoySklad "Технологическая карта"): rekvizitlar + tablar
// Mahsulot · Materiallar (bosqich bo'yicha, me'yor) · Xarajatlar · Ko'rsatma
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { DocField, DocPage, ProductSearch } from '../../components/DocEditor'
import { DropMenu, SearchSelect } from '../../components/Controls'
import { confirmDialog } from '../../components/Confirm'
import { downloadFile } from '../../components/Download'
import Icon, { IconBtn } from '../../components/Icon'
import { esc, openPrint } from '../../components/Print'
import { Modal, toast, useFetch } from '../../components/ui'
import { convertPrice, useCurrencies } from '../../currency'
import { money, qty } from '../../format'
import { t } from '../../i18n'
import { NumInput } from '../../components/Inputs'

let seq = 0
const key = () => `n${++seq}`
const toRow = (m) => ({ key: m.id ? `m${m.id}` : key(), material: m.material, name: m.material_name || m.name, code: m.code || '',
  unit: m.unit || '', qty: String(Number(m.qty)), operation: m.operation || '', unit_cost: m.unit_cost ?? '0', currency: m.currency || 'UZS' })

export function TechCardForm({ item, presetProduct, onClose, onSaved }) {
  const { user } = useAuth()
  const nav = useNavigate()
  useCurrencies({ all: true }) // kurslar yuklanadi — USD materiallar mahsulot valyutasiga o'giriladi
  const [id, setId] = useState(item?.id || null)
  const [cost, setCost] = useState(item?.cost || null)
  const products = useFetch('/warehouse/products/', { type: 'product,goods', is_active: true })
  const processes = useFetch('/production/processes/')
  const init = () => ({
    name: item?.name || '', product: item?.product || presetProduct || '', output_qty: item ? String(Number(item.output_qty)) : '1',
    process: item?.process || '', note: item?.note || '', instructions: item?.instructions || '',
    extra_cost: item ? String(Number(item.extra_cost || 0)) : '0', is_active: item?.is_active ?? true,
  })
  const [v, setV] = useState(init)
  const [rows, setRows] = useState(() => (item?.materials || []).map(toRow))
  const [tab, setTab] = useState(item ? 'materials' : 'product')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imp, setImp] = useState(null)
  const fileRef = useRef(null)
  const editable = id ? canEdit(user, 'production') : canCreate(user, 'production')

  const set = (k, val) => { setV((x) => ({ ...x, [k]: val })); setDirty(true) }
  const setRow = (k, patch) => { setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r))); setDirty(true) }
  const proc = (processes.data || []).find((p) => String(p.id) === String(v.process))
  const prod = (products.data || []).find((p) => String(p.id) === String(v.product))
  const stages = proc?.stages || []
  const out = Number(v.output_qty) || 1
  const pcur = prod?.currency || item?.product_currency || 'UZS'

  // Materiallar bosqichlar tartibida (MoySklad: Этап → materiallar)
  const stageIdx = (op) => { const i = stages.findIndex((s) => String(s.operation) === String(op)); return i < 0 ? (op ? 998 : -1) : i }
  const view = useMemo(() => [...rows].map((r, i) => ({ ...r, _i: i })).sort((a, b) => stageIdx(a.operation) - stageIdx(b.operation) || a._i - b._i),
    [rows, stages]) // eslint-disable-line react-hooks/exhaustive-deps
  const stageName = (op) => (op ? (stages.find((s) => String(s.operation) === String(op))?.operation_name || t('Boshqa bosqich')) : (stages[0] ? stages[0].operation_name : t('Asosiy bosqich')))
  const matSum = rows.reduce((a, r) => a + convertPrice(Number(r.qty || 0) * Number(r.unit_cost || 0), r.currency, pcur), 0)

  const addMaterial = (p) => {
    setRows((rs) => {
      const same = rs.find((r) => String(r.material) === String(p.id))
      if (same) return rs.map((r) => (r === same ? { ...r, qty: String(Number(r.qty || 0) + 1) } : r))
      return [...rs, { key: key(), material: p.id, name: p.name, code: p.code || '', unit: p.unit_display || '', qty: '1',
        operation: stages[0]?.operation || '', unit_cost: p.purchase_price || '0', currency: p.currency || 'UZS' }]
    })
    setDirty(true)
  }

  const importFile = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post('/production/techcards/import_materials/', fd)
      setRows((rs) => {
        const outRows = [...rs]
        data.lines.forEach((x) => {
          const i = outRows.findIndex((r) => String(r.material) === String(x.material))
          if (i >= 0) outRows[i] = { ...outRows[i], qty: String(Number(x.qty)) }
          else outRows.push({ key: key(), material: x.material, name: x.name, code: x.code || '', unit: x.unit, qty: String(Number(x.qty)),
            operation: stages[0]?.operation || '', unit_cost: x.purchase_price || '0', currency: x.currency || 'UZS' })
        })
        return outRows
      })
      setDirty(true)
      setImp({ name: file.name, added: data.lines.length, errors: data.errors })
    } catch (e) { toast(errorText(e), true) }
    if (fileRef.current) fileRef.current.value = ''
  }

  const canSave = editable && !busy && v.product && Number(v.output_qty) > 0
  const save = async (close) => {
    setBusy(true)
    const payload = { ...v, process: v.process || null, name: v.name || prod?.name || '', extra_cost: v.extra_cost || '0',
      materials: rows.filter((r) => r.material && Number(r.qty) > 0).map((r) => ({ material: r.material, qty: r.qty, operation: r.operation || null })) }
    try {
      const { data } = id ? await api.patch(`/production/techcards/${id}/`, payload) : await api.post('/production/techcards/', payload)
      setDirty(false)
      if (close) { onSaved(data); return }
      setId(data.id); setCost(data.cost); setRows(data.materials.map(toRow)); setV((x) => ({ ...x, name: data.name }))
      toast(t('Texkarta saqlandi'))
    } catch (e) { toast(errorText(e), true) } finally { setBusy(false) }
  }
  const close = async () => {
    if (dirty && !(await confirmDialog(t("Saqlanmagan o'zgarishlar bor. Yopilsinmi?")))) return
    onClose()
  }
  const remove = async () => {
    if (!(await confirmDialog(t('"{n}" o\'chirilsinmi?', { n: v.name || prod?.name || '' })))) return
    try { await api.delete(`/production/techcards/${id}/`); onSaved(null) } catch (e) { toast(errorText(e), true) }
  }
  const makeProdOrder = async () => {
    try {
      const { data } = await api.post('/production/orders/', { items: [{ techcard: id, qty: v.output_qty }], note: v.name })
      toast(t('Ishlab chiqarish buyurtmasi №{n}', { n: data.number }))
      nav(`/production?tab=orders&po=${data.id}`)
      onClose()
    } catch (e) { toast(errorText(e), true) }
  }
  const print = () => {
    const body = `<h1>${esc(t('Texnologik karta'))}: ${esc(v.name || prod?.name)}</h1>
      <div class="muted">${esc(t('Mahsulot'))}: ${esc(prod?.name || item?.product_name || '')} — ${esc(qty(out))} ${esc(t(prod?.unit_display || item?.product_unit || ''))}
      ${proc ? ` · ${esc(t('Texjarayon'))}: ${esc(proc.name)}` : ''}</div>
      <table><thead><tr><th>№</th><th>${esc(t('Bosqich'))}</th><th>${esc(t('Kod'))}</th><th>${esc(t('Material'))}</th><th class="num">${esc(t("Me'yor"))}</th><th>${esc(t('Birlik'))}</th></tr></thead><tbody>
      ${view.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(stageName(r.operation))}</td><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${esc(qty(r.qty))}</td><td>${esc(t(r.unit))}</td></tr>`).join('')}
      </tbody></table>
      ${v.instructions ? `<h3>${esc(t("Ko'rsatma"))}</h3><div style="white-space:pre-wrap">${esc(v.instructions)}</div>` : ''}`
    openPrint(`${t('Texkarta')} ${v.name}`, body)
  }

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button type="button" className="btn primary" disabled={!canSave} onClick={() => save(false)}><Icon name="save" size={16} /> {busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        <button type="button" className="btn" disabled={!canSave} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>
        <button type="button" className="btn" onClick={close}>{t('Yopish')}</button>
        <DropMenu label={t('Yaratish')} icon="plus" items={[
          [t('Ishlab chiqarish buyurtmasi'), makeProdOrder, !id || dirty || !canCreate(user, 'production')],
        ]} />
        <DropMenu label={t('Pechat')} icon="print" items={[[t('Texnologik karta'), print]]} />
        <span className="grow" />
        {dirty && <span className="small muted">{t("Saqlanmagan o'zgarishlar")}</span>}
        <label className="check posted-check"><input type="checkbox" checked={v.is_active} disabled={!editable} onChange={(e) => set('is_active', e.target.checked)} /> {t('Faol')}</label>
        {id && canDelete(user, 'production') && <button type="button" className="icon-act danger" title={t("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
      </>}
    >
      <div className="doc-titlebar"><h1>{t('Texnologik karta')}</h1></div>
      <div className="doc-grid">
        <DocField label="Nomi"><input value={v.name} disabled={!editable} placeholder={prod?.name || t("bo'sh — mahsulot nomi")} onChange={(e) => set('name', e.target.value)} /></DocField>
        <DocField label="Texjarayon">
          <SearchSelect value={v.process} onChange={(x) => set('process', x)} empty="—" disabled={!editable}
            options={(processes.data || []).map((p) => ({ value: p.id, label: p.name, sub: t('{n} bosqich', { n: p.stages.length }) }))} />
        </DocField>
        <DocField label="Izoh"><input value={v.note} disabled={!editable} onChange={(e) => set('note', e.target.value)} /></DocField>
      </div>
      {proc && <p className="hint" style={{ margin: '8px 2px 0' }}>{t('Bosqichlar')}: {stages.map((s) => s.operation_name).join(' → ') || '—'}</p>}

      <div className="doc-tabs tc-tabs">
        {[['product', t('Mahsulot')], ['materials', t('Materiallar') + (rows.length ? ` (${rows.length})` : '')], ['money', t('Xarajatlar')], ['instr', t("Ko'rsatma")]].map(([k, l]) => (
          <button type="button" key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
        {tab === 'materials' && editable && (
          <span className="tc-tab-act">
            <DropMenu label={t('Import')} icon="upload" align="right" items={[
              [t("Excel'dan import (.xlsx, .csv)"), () => fileRef.current?.click()],
              [t('Shablonni yuklab olish'), () => downloadFile('/production/techcards/import_template/', {}, 'shablon-texkarta.xlsx')],
            ]} />
          </span>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => importFile(e.target.files[0])} />
      </div>

      {tab === 'product' && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th style={{ width: '55%' }}>{t('Mahsulot')}</th><th className="num">{t("Texkarta bo'yicha me'yor")}</th><th>{t('Birlik')}</th><th className="num">{t('Rejaviy tannarx / birlik')}</th></tr></thead>
            <tbody>
              <tr>
                <td>
                  <SearchSelect value={v.product} onChange={(x) => set('product', x)} placeholder={t('— mahsulotni tanlang —')} disabled={!editable}
                    options={(products.data || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} />
                </td>
                <td className="num"><NumInput className="cell num" step="any" min="0" value={v.output_qty} disabled={!editable} onChange={(e) => set('output_qty', e.target.value)} /></td>
                <td>{t(prod?.unit_display || item?.product_unit || '')}</td>
                <td className="num bold">{money((matSum + Number(cost?.labor || 0) * out + Number(v.extra_cost || 0)) / out, pcur)}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint" style={{ padding: '0 12px 10px' }}>{t("Me'yor — materiallar shu miqdordagi mahsulot uchun yoziladi. Buyurtmada miqdorga mutanosib hisoblanadi.")}</p>
        </div>
      )}

      {tab === 'materials' && (
        <div className="table-wrap">
          <table className="t tc-mat">
            <thead><tr>
              <th style={{ width: 190 }}>{t('Bosqich')}</th><th>{t('Material')}</th>
              <th className="num" style={{ width: 150 }}>{t("Me'yor")} <span className="muted small">({qty(out)} {t(prod?.unit_display || '')})</span></th>
              <th>{t('Birlik')}</th><th className="num">{t('Tannarx')}</th><th className="num">{t('Summa')}</th><th style={{ width: 40 }} />
            </tr></thead>
            <tbody>
              {view.map((r, i) => {
                const first = i === 0 || String(view[i - 1].operation || '') !== String(r.operation || '')
                return (
                  <tr key={r.key} className={first && i ? 'tc-stage-start' : ''}>
                    <td>
                      {editable ? (
                        <select className="cell" value={r.operation} onChange={(e) => setRow(r.key, { operation: e.target.value })}>
                          <option value="">{stages[0] ? `${stages[0].operation_name} (${t('birinchi')})` : t('Asosiy bosqich')}</option>
                          {stages.map((s) => <option key={s.id} value={s.operation}>{s.operation_name}</option>)}
                        </select>
                      ) : (first ? stageName(r.operation) : '')}
                    </td>
                    <td>{r.code && <b className="pos-code">{r.code}</b>} {r.name}</td>
                    <td className="num"><NumInput className="cell num" step="any" min="0" value={r.qty} disabled={!editable} onChange={(e) => setRow(r.key, { qty: e.target.value })} /></td>
                    <td className="muted">{t(r.unit)}</td>
                    <td className="num small">{money(r.unit_cost, r.currency)}</td>
                    <td className="num">{money(Number(r.qty || 0) * Number(r.unit_cost || 0), r.currency)}</td>
                    <td className="num">{editable && <IconBtn icon="delete" danger title="O'chirish" onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true) }} />}</td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={7} className="empty">{t("Materiallar yo'q. Pastdagi qidiruvdan qo'shing yoki Excel'dan import qiling.")}</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr><td colSpan={5}>{t('Jami materiallar')} ({qty(out)} {t(prod?.unit_display || '')})</td><td className="num bold">{money(matSum, pcur)}</td><td /></tr></tfoot>
            )}
          </table>
          {editable && <div className="tc-add"><ProductSearch onPick={addMaterial} params={{ type: 'raw,goods,product' }} /></div>}
        </div>
      )}

      {tab === 'money' && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Modda')}</th><th className="num">{t("Texkarta bo'yicha")} ({qty(out)} {t(prod?.unit_display || '')})</th><th className="num">{t('1 {u} uchun', { u: t(prod?.unit_display || 'birlik') })}</th></tr></thead>
            <tbody>
              <tr><td>{t('Materiallar')}</td><td className="num">{money(matSum, pcur)}</td><td className="num">{money(matSum / out, pcur)}</td></tr>
              <tr><td>{t("Ish haqi (bosqichlar ishbay stavkasi)")}{!id && <div className="small muted">{t('saqlangandan keyin hisoblanadi')}</div>}</td>
                <td className="num">{money(Number(cost?.labor || 0) * out, pcur)}</td><td className="num">{money(cost?.labor || 0, pcur)}</td></tr>
              <tr><td>{t("Qo'shimcha xarajatlar")} <span className="muted small">({t('elektr, qadoq, transport…')})</span></td>
                <td className="num"><NumInput className="cell num" step="any" min="0" value={v.extra_cost} disabled={!editable} onChange={(e) => set('extra_cost', e.target.value)} /></td>
                <td className="num">{money(Number(v.extra_cost || 0) / out, pcur)}</td></tr>
            </tbody>
            <tfoot><tr><td>{t('Rejaviy tannarx')}</td>
              <td className="num bold">{money(matSum + Number(cost?.labor || 0) * out + Number(v.extra_cost || 0), pcur)}</td>
              <td className="num bold">{money((matSum + Number(cost?.labor || 0) * out + Number(v.extra_cost || 0)) / out, pcur)}</td></tr></tfoot>
          </table>
          <p className="hint" style={{ padding: '0 12px 10px' }}>{t("Material tannarxi — ombordagi o'rtacha narx (qoldiq bo'lmasa xarid narxi).")}</p>
        </div>
      )}

      {tab === 'instr' && (
        <div className="card">
          <textarea className="tc-instr" rows={10} value={v.instructions} disabled={!editable} placeholder={t("Ishlab chiqarish bo'yicha ko'rsatma: tartib, o'lchamlar, sifat talablari…")}
            onChange={(e) => set('instructions', e.target.value)} />
        </div>
      )}

      {imp && (
        <Modal dialog title={t('Import natijasi')} onClose={() => setImp(null)}>
          <p style={{ marginTop: 0 }}><b>{imp.name}</b></p>
          <p className="green">{t("Qo'shildi: {n} ta pozitsiya", { n: imp.added })}</p>
          {imp.errors.length > 0 && <>
            <p className="red" style={{ marginBottom: 0 }}>{t('Xatoliklar: {n} ta qator', { n: imp.errors.length })}</p>
            <ul className="doc-import-err">{imp.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </>}
          <p className="muted small">{t('Materiallarni tekshirib, texkartani saqlang.')}</p>
          <div className="form-actions"><button className="btn primary" onClick={() => setImp(null)}>{t('OK')}</button></div>
        </Modal>
      )}
    </DocPage>
  )
}

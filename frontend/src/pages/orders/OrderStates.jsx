// Buyurtma statuslari (MoySklad: Настройки → Статусы): nomi, rangi, turi; qo'shish, o'chirish, tartib.
import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { confirmDialog } from '../../components/Confirm'
import { IconBtn } from '../../components/Icon'
import { Loading, Modal, toast, useFetch } from '../../components/ui'
import { t } from '../../i18n'

export const STATE_KINDS = [
  ['new', t('Yangi')], ['confirmed', t('Tasdiqlandi')], ['in_production', t('Ishlab chiqarishda')],
  ['ready', t('Tayyor')], ['delivered', t('Topshirildi')], ['cancelled', t('Bekor qilindi')],
]

// Statusga avtomatik o'tish (ishlab chiqarish / sotuv hodisalari) va unga mos tizim turi
export const STATE_TRIGGERS = [
  ['', t("— qo'lda —"), null],
  ['sent_to_production', t('Ishlab chiqarishga berilganda'), 'confirmed'],
  ['production_started', t('Ish boshlanganda'), 'in_production'],
  ['department', t("Bosqich shu bo'limga kelganda"), 'in_production'],
  ['production_done', t('Ishlab chiqarish tugaganda'), 'ready'],
  ['sold', t("Sotuv o'tkazilganda"), 'delivered'],
]
const TRIGGER_KIND = Object.fromEntries(STATE_TRIGGERS.map(([k, , kind]) => [k, kind]))

let cache = null
const subs = new Set()
export function loadOrderStates(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  return api.get('/orders/states/').then(({ data }) => { cache = data.results || data; subs.forEach((f) => f(cache)); return cache })
}

/** Statuslar ro'yxati (bitta so'rov, o'zgarsa hamma joy yangilanadi) */
export function useOrderStates() {
  const [v, setV] = useState(cache)
  useEffect(() => {
    subs.add(setV)
    loadOrderStates().catch(() => {})
    return () => subs.delete(setV)
  }, [])
  return v || []
}

/** Rangli status belgisi */
export function StateBadge({ order }) {
  const c = order.state_color
  return (
    <span className={'badge state-badge b-' + order.status} style={c ? { color: c, background: `color-mix(in srgb, ${c} 13%, transparent)` } : undefined}>
      {t(order.status_display)}
    </span>
  )
}

export function OrderStatesManager({ onClose }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const deps = useFetch('/production/departments/')
  const load = () => loadOrderStates(true).then((d) => setRows(d.map((x) => ({ ...x })))).catch((e) => toast(errorText(e), true))
  useEffect(() => { load() }, [])

  const set = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, _dirty: true } : r)))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRows(next.map((r) => ({ ...r, _moved: true })))
  }
  const add = () => setRows((rs) => [...rs, { id: `new${Date.now()}`, isNew: true, name: '', color: '#64748b', kind: 'new', trigger: '', department: null, orders_count: 0, _dirty: true }])
  const setTrigger = (r, trigger) => set(r.id, { trigger, kind: TRIGGER_KIND[trigger] || r.kind, department: trigger === 'department' ? r.department : null })
  const remove = async (r) => {
    if (r.isNew) { setRows((rs) => rs.filter((x) => x.id !== r.id)); return }
    if (!(await confirmDialog(t('«{n}» statusi o\'chirilsinmi?', { n: r.name })))) return
    try { await api.delete(`/orders/states/${r.id}/`); load(); toast(t("O'chirildi")) } catch (e) { toast(errorText(e), true) }
  }
  const save = async () => {
    setBusy(true)
    try {
      const ids = []
      for (const r of rows) {
        const body = { name: r.name.trim(), color: r.color, kind: r.kind, trigger: r.trigger || '', department: r.trigger === 'department' ? r.department || null : null }
        if (!body.name) throw new Error(t('Status nomi bo\'sh'))
        if (body.trigger === 'department' && !body.department) throw new Error(t('«{n}»: bo\'limni tanlang', { n: body.name }))
        if (r.isNew) ids.push((await api.post('/orders/states/', body)).data.id)
        else { if (r._dirty) await api.patch(`/orders/states/${r.id}/`, body); ids.push(r.id) }
      }
      await api.post('/orders/states/reorder/', { ids })
      await loadOrderStates(true)
      toast(t('Statuslar saqlandi'))
      onClose()
    } catch (e) { toast(e.response ? errorText(e) : e.message, true) } finally { setBusy(false) }
  }

  return (
    <Modal dialog wide title={t('Buyurtma statuslari')} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {t("Statuslarni o'zingiz nomlaysiz, rang berasiz, qo'shasiz va o'chirasiz. \"Avtomatik o'tish\" — buyurtma qaysi hodisada shu statusga o'zi o'tadi: ishlab chiqarishga berilganda, ish boshlanganda, bosqich ma'lum bo'limga kelganda (masalan, \"Kesishda\", \"Payvandlashda\"), ishlab chiqarish tugaganda yoki sotuv o'tkazilganda. Qo'lda ham istalgan payt o'zgartirish mumkin.")}
      </p>
      {!rows ? <Loading /> : (
        <div className="table-wrap">
          <table className="t states-t">
            <thead><tr><th style={{ width: 70 }} /><th>{t('Nomi')}</th><th style={{ width: 70 }}>{t('Rang')}</th><th>{t('Turi')}</th><th>{t("Avtomatik o'tish")}</th><th className="num">{t('Buyurtmalar')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="state-move">
                    <button type="button" className="icon-act" disabled={i === 0} onClick={() => move(i, -1)} title={t('Yuqoriga')}>↑</button>
                    <button type="button" className="icon-act" disabled={i === rows.length - 1} onClick={() => move(i, 1)} title={t('Pastga')}>↓</button>
                  </td>
                  <td><input className="cell state-name" value={r.name} placeholder={t('Status nomi')} onChange={(e) => set(r.id, { name: e.target.value })} /></td>
                  <td><input type="color" className="state-color" value={r.color} onChange={(e) => set(r.id, { color: e.target.value })} /></td>
                  <td>
                    <select className="cell" value={r.kind} disabled={!!r.trigger} title={r.trigger ? t("Tur avtomatik o'tish hodisasiga qarab belgilanadi") : ''} onChange={(e) => set(r.id, { kind: e.target.value })}>
                      {STATE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="cell" value={r.trigger || ''} onChange={(e) => setTrigger(r, e.target.value)}>
                      {STATE_TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    {r.trigger === 'department' && (
                      <select className="cell" style={{ marginTop: 4 }} value={r.department || ''} onChange={(e) => set(r.id, { department: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">{t("— bo'lim —")}</option>
                        {(deps.data?.results || deps.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="num">{r.orders_count || '—'}</td>
                  <td className="num"><IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
            <button type="button" className="btn small" onClick={add}>+ {t('Status')}</button>
          </div>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>{t('Bekor')}</button>
        <button type="button" className="btn primary" disabled={busy || !rows} onClick={save}>{t('Saqlash')}</button>
      </div>
    </Modal>
  )
}

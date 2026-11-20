// "Yangi kontragent" oynasi — hujjatlarda (buyurtma, sotuv, qabul qilish, to'lov) kontragent tanlashda yaratish uchun.
// Foydalanish: const cp = await newCounterpartyDialog({ name: 'Ali', group: 'Mijozlar' })  → yaratilgan obyekt yoki null
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import api from '../api'
import { localizeError } from '../errors'
import { t } from '../i18n'

function Dialog({ initial, done }) {
  const [v, setV] = useState({ name: initial.name || '', kind: 'individual', phone: '', inn: '', address: '', note: '', groups: [] })
  const [groups, setGroups] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)
  useEffect(() => {
    nameRef.current?.focus()
    api.get('/crm/groups/').then(({ data }) => {
      const list = data.results || data
      setGroups(list)
      const pre = initial.group && list.find((g) => g.name.toLowerCase() === initial.group.toLowerCase())
      if (pre) setV((x) => ({ ...x, groups: [pre.id] }))
    }).catch(() => {})
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null) } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }))
  const toggle = (id) => set('groups', v.groups.includes(id) ? v.groups.filter((g) => g !== id) : [...v.groups, id])
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post('/crm/counterparties/', v)
      done(data)
    } catch (err) { setError(localizeError(err)); setBusy(false) }
  }
  return (
    <div className="modal-back confirm-back" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 620 }}>
        <div className="modal-head"><h2 style={{ margin: 0 }}>{t('Yangi kontragent')}</h2>
          <button className="x" type="button" onClick={() => done(null)} aria-label={t('Yopish')}>×</button></div>
        {error && <div className="error">{error}</div>}
        <form className="form" onSubmit={save}>
          <div className="field full"><label>{t('Nomi')} *</label><input ref={nameRef} value={v.name} required onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>{t('Turi')}</label>
            <select value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="individual">{t('Jismoniy shaxs')}</option><option value="legal">{t('Yuridik shaxs')}</option>
            </select></div>
          <div className="field"><label>{t('Telefon')}</label><input value={v.phone} placeholder="+998 90 000 00 00" onChange={(e) => set('phone', e.target.value)} /></div>
          {v.kind === 'legal' && <div className="field"><label>{t('STIR')}</label><input value={v.inn} onChange={(e) => set('inn', e.target.value)} /></div>}
          <div className={'field' + (v.kind === 'legal' ? '' : ' full')}><label>{t('Manzil')}</label><input value={v.address} onChange={(e) => set('address', e.target.value)} /></div>
          {groups.length > 0 && (
            <div className="field full"><label>{t('Guruhlar')}</label>
              <div className="filters">
                {groups.map((g) => (
                  <button type="button" key={g.id} className={'chip' + (v.groups.includes(g.id) ? ' on' : '')} onClick={() => toggle(g.id)}>{g.name}</button>
                ))}
              </div></div>
          )}
          <div className="field full"><label>{t('Izoh')}</label><input value={v.note} onChange={(e) => set('note', e.target.value)} /></div>
          <div className="full form-actions">
            <button type="button" className="btn" onClick={() => done(null)}>{t('Bekor')}</button>
            <button className="btn primary" disabled={busy || !v.name.trim()}>{t('Yaratish')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** → Promise<kontragent | null> */
export function newCounterpartyDialog(initial = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<Dialog initial={initial} done={done} />)
  })
}

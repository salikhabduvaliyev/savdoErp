// Kontragent tanlash (MoySklad uslubi): chapda ro'yxat va qidiruv, o'ngda guruhlar (teglar) — bosilsa ro'yxat filtrlanadi.
// `employees` berilsa "Xodimlar" guruhi ham chiqadi; xodim qiymati "e:<id>" ko'rinishida qaytadi (ish haqi to'lovi uchun).
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { t } from '../i18n'

const norm = (s) => String(s || '').toLowerCase()

export default function PartyPicker({ value, onChange, counterparties = [], groups = [], employees = null, disabled, placeholder, empty, onCreate }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [grp, setGrp] = useState(null) // null — hammasi, 'emp' — xodimlar, id — guruh
  const box = useRef(null)
  const input = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    setTimeout(() => input.current?.focus(), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const all = useMemo(() => [
    ...counterparties.map((c) => ({ value: String(c.id), label: c.name, sub: c.phone, groups: c.groups || [] })),
    ...(employees || []).map((e) => ({ value: `e:${e.id}`, label: e.full_name, sub: e.department_name || e.position || t('xodim'), emp: true })),
  ], [counterparties, employees])
  const sel = all.find((o) => o.value === String(value ?? ''))
  const list = all.filter((o) => (grp === null || (grp === 'emp' ? o.emp : !o.emp && o.groups.includes(grp)))
    && (!q.trim() || norm(o.label).includes(norm(q.trim())) || norm(o.sub).includes(norm(q.trim())))).slice(0, 300)
  const pick = (v) => { onChange(v); setOpen(false); setQ('') }

  return (
    <div className={'ss party' + (disabled ? ' disabled' : '') + (open ? ' open' : '')} ref={box}>
      <button type="button" className="ss-btn" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled}>
        <span className={sel ? 'ss-val' : 'ss-ph'}>{sel ? <>{sel.emp && <span className="party-emp">{t('xodim')}</span>}{sel.label}</> : (empty ?? placeholder ?? t('— tanlang —'))}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="ss-pop party-pop">
          <div className="party-main">
            <div className="ss-search">
              <Icon name="search" size={15} />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Qidirish…')}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } if (e.key === 'Enter' && list[0]) { e.preventDefault(); pick(list[0].value) } }} />
            </div>
            <div className="ss-list">
              {empty !== undefined && <button type="button" className="ss-item muted" onClick={() => pick('')}><span>{empty}</span></button>}
              {list.map((o) => (
                <button type="button" key={o.value} className={'ss-item' + (o.value === String(value ?? '') ? ' sel' : '')} onClick={() => pick(o.value)}>
                  <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
                </button>
              ))}
              {!list.length && <div className="ss-empty">{t('Topilmadi')}</div>}
            </div>
            {onCreate && (
              <button type="button" className="ss-create" onClick={() => { onCreate(q.trim()); setOpen(false); setQ('') }}>
                <Icon name="plus" size={15} /> {q.trim() ? t('«{q}» — yangi yaratish', { q: q.trim() }) : t('Yangi kontragent')}
              </button>
            )}
          </div>
          <div className="party-groups">
            <button type="button" className={'party-chip' + (grp === null ? ' on' : '')} onClick={() => setGrp(null)}>{t('Hammasi')}</button>
            {employees && <button type="button" className={'party-chip emp' + (grp === 'emp' ? ' on' : '')} onClick={() => setGrp('emp')}>{t('Xodimlar')}</button>}
            {groups.map((g) => (
              <button type="button" key={g.id} className={'party-chip' + (grp === g.id ? ' on' : '')} style={{ '--c': g.color || 'var(--primary)' }} onClick={() => setGrp(g.id)}>{g.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

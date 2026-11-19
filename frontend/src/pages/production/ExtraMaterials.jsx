// Bosqichni bajarishda texkartadan tashqari sarflangan qo'shimcha materiallar (ixcham ro'yxat).
// value: [{ key, material, name, unit, qty }]
import { useState } from 'react'
import { SearchSelect } from '../../components/Controls'
import { IconBtn } from '../../components/Icon'
import { useFetch } from '../../components/ui'
import { t } from '../../i18n'

let n = 0

export default function ExtraMaterials({ value, onChange, compact }) {
  const [open, setOpen] = useState(value.length > 0)
  const mats = useFetch(open ? '/warehouse/products/' : null, { type: 'raw,goods,product', is_active: true })
  const byId = Object.fromEntries((mats.data?.results || mats.data || []).map((m) => [String(m.id), m]))
  const add = (id) => {
    if (!id) return
    const m = byId[String(id)]
    const same = value.find((r) => String(r.material) === String(id))
    if (same) return
    onChange([...value, { key: ++n, material: id, name: m?.name || '', unit: m?.unit_display || '', qty: '1' }])
  }
  const set = (key, qty) => onChange(value.map((r) => (r.key === key ? { ...r, qty } : r)))

  if (!open) {
    return <button type="button" className="link-btn small extra-mat-btn" onClick={() => setOpen(true)}>+ {t("Qo'shimcha material")}</button>
  }
  return (
    <div className={'extra-mats' + (compact ? ' compact' : '')}>
      <div className="extra-mats-head">{t("Qo'shimcha materiallar")} <span className="muted small">({t('omborda chiqim qilinadi')})</span></div>
      {value.map((r) => (
        <div key={r.key} className="extra-mat-row">
          <span className="grow">{r.name}</span>
          <input inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, e.target.value.replace(',', '.'))} />
          <span className="muted small">{t(r.unit)}</span>
          <IconBtn icon="delete" danger title="O'chirish" onClick={() => onChange(value.filter((x) => x.key !== r.key))} />
        </div>
      ))}
      <SearchSelect value="" onChange={add} placeholder={t('+ material tanlang…')}
        options={Object.values(byId).map((m) => ({ value: m.id, label: m.name, sub: `${m.code || ''} · ${t(m.unit_display || '')}` }))} />
    </div>
  )
}

/** API uchun: [{material, qty}] */
export const extraPayload = (rows) => rows.filter((r) => r.material && Number(r.qty) > 0).map((r) => ({ material: r.material, qty: r.qty }))

// Standart maydonlar sozlamasi (Sozlamalar → Maydonlar): nomini o'zgartirish va formada yashirish
import { useFetch } from './ui'
import { t } from '../i18n'

// type — maydon dasturda nimaga bog'langani (ma'lumot turi)
// eslint-disable-next-line react-refresh/only-export-components
export const STANDARD_FIELDS = {
  // majburiy maydonlar (mijoz, muddat, valyuta, ombor ...) bu ro'yxatda yo'q — ular har doim formada
  order: [
    { key: 'manager', label: 'Menejer', type: "Foydalanuvchi (sotuvchi)" },
    { key: 'operator', label: 'Operator', type: "Foydalanuvchi" },
    { key: 'volume', label: 'Hajm, m²', type: "Son (m²) — kalendar yuklamasi" },
  ],
  sale: [],
  counterparty: [],
}

/** Formada: fc.label('manager', 'Menejer'), fc.hidden('manager') */
// eslint-disable-next-line react-refresh/only-export-components
export function useFieldConfig(entity) {
  const { data } = useFetch('/core/settings/')
  const cfg = data?.field_config?.[entity] || {}
  const known = (key) => (STANDARD_FIELDS[entity] || []).some((f) => f.key === key)
  return {
    label: (key, def) => (known(key) && cfg[key]?.label) || t(def),
    // faqat ixtiyoriy standart maydonlarni yashirish mumkin
    hidden: (key) => !!cfg[key]?.hidden && known(key),
  }
}

// Standart maydonlar sozlamasi (Sozlamalar → Maydonlar): nomini o'zgartirish va formada yashirish
import { useFetch } from './ui'
import { t } from '../i18n'

// type — maydon dasturda nimaga bog'langani (ma'lumot turi)
// eslint-disable-next-line react-refresh/only-export-components
export const STANDARD_FIELDS = {
  order: [
    { key: 'client', label: 'Mijoz', type: "Kontragent (mijoz)", locked: true },
    { key: 'manager', label: 'Menejer', type: "Foydalanuvchi (sotuvchi)" },
    { key: 'operator', label: 'Operator', type: "Foydalanuvchi" },
    { key: 'plan_date', label: 'Topshirish muddati', type: "Sana", locked: true },
    { key: 'production_date', label: 'Ishlab chiqarish kuni', type: "Sana" },
    { key: 'volume', label: 'Hajm, m²', type: "Son (m²) — kalendar yuklamasi" },
    { key: 'currency', label: 'Valyuta', type: "Valyuta", locked: true },
    { key: 'price_type', label: 'Narx turi', type: "Narx turi (ma'lumotnoma)" },
  ],
  sale: [
    { key: 'client', label: 'Mijoz', type: "Kontragent (mijoz)", locked: true },
    { key: 'warehouse', label: 'Ombor', type: "Ombor", locked: true },
    { key: 'price_type', label: 'Narx turi', type: "Narx turi (ma'lumotnoma)" },
    { key: 'currency', label: 'Valyuta', type: "Valyuta", locked: true },
    { key: 'discount', label: 'Chegirma', type: "Son (summa)" },
  ],
  counterparty: [],
}

/** Formada: fc.label('manager', 'Menejer'), fc.hidden('manager') */
// eslint-disable-next-line react-refresh/only-export-components
export function useFieldConfig(entity) {
  const { data } = useFetch('/core/settings/')
  const cfg = data?.field_config?.[entity] || {}
  return {
    label: (key, def) => cfg[key]?.label || t(def),
    hidden: (key) => !!cfg[key]?.hidden,
  }
}

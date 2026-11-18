// Valyutalar ma'lumotnomasi (Sozlamalar → Valyutalar). Asosiy valyuta — so'm (UZS).
import { useEffect, useState } from 'react'
import api from './api'
import { t } from './i18n'

const FALLBACK = [
  { code: 'UZS', name: "O'zbek so'mi", symbol: "so'm", is_base: true, is_active: true },
  { code: 'USD', name: 'AQSh dollari', symbol: '$', is_base: false, is_active: true },
]
let list = FALLBACK
let loading = null
const subs = new Set()

export function loadCurrencies(force = false) {
  if (loading && !force) return loading
  loading = api.get('/core/currencies/')
    .then(({ data }) => { list = (data.results || data).length ? (data.results || data) : FALLBACK; subs.forEach((f) => f(list)) })
    .catch(() => { loading = null })
  return loading
}

export const getCurrencies = () => list
export const findCurrency = (code) => list.find((c) => c.code === code)

/** Ko'rsatish uchun qisqa nom: UZS → so'm, USD → USD, EUR → EUR */
export function curLabel(code) {
  if (!code || code === 'UZS') return t("so'm")
  return code
}

/** Faol valyutalar ro'yxati (ma'lumotnoma o'zgarsa yangilanadi). */
export function useCurrencies({ all = false } = {}) {
  const [v, setV] = useState(list)
  useEffect(() => {
    subs.add(setV)
    loadCurrencies()
    return () => subs.delete(setV)
  }, [])
  return all ? v : v.filter((c) => c.is_active)
}

/** <select> uchun valyuta variantlari. `value` ma'lumotnomada bo'lmasa ham ko'rsatiladi. */
export function CurrencyOptions({ withName = false, value }) {
  const cs = useCurrencies()
  const rows = value && !cs.some((c) => c.code === value) ? [...cs, { code: value, name: value }] : cs
  return rows.map((c) => (
    <option key={c.code} value={c.code}>{curLabel(c.code)}{withName && c.code !== 'UZS' && c.name ? ` — ${t(c.name)}` : ''}{withName && c.code === 'UZS' ? ' (UZS)' : ''}</option>
  ))
}

/** EntityForm uchun: [[code, label], ...] */
export const currencyOptions = () => list.filter((c) => c.is_active).map((c) => [c.code, curLabel(c.code)])

/** 1 birlik valyuta necha so'm (ma'lumotnomadagi oxirgi kurs). Topilmasa — null. */
export function rateOf(code) {
  if (!code || code === 'UZS') return 1
  const c = findCurrency(code)
  return c?.rate ? Number(c.rate) : null
}

/** Narxni bir valyutadan boshqasiga joriy kurs bo'yicha aylantirish (so'm orqali). Kurs bo'lmasa — o'zgarmaydi. */
export function convertPrice(amount, from, to) {
  if (amount === '' || amount === null || amount === undefined) return amount
  const n = Number(amount)
  if (!from || !to || from === to || !n) return n
  const a = rateOf(from)
  const b = rateOf(to)
  if (!a || !b) return n
  const v = (n * a) / b
  const k = to === 'UZS' ? 100 : 10000
  return Math.round(v * k) / k
}

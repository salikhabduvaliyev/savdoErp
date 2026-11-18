import { t } from './i18n'

// Formatlash: so'm — butun son, bo'sh joy bilan; USD — "$ 4 200,00".
const nbsp = ' '

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)
}

export function num(value, digits = 0) {
  const n = Number(value || 0)
  const sign = n < 0 ? '−' : ''
  const [i, f] = Math.abs(n).toFixed(digits).split('.')
  return sign + group(i) + (f ? ',' + f : '')
}

export function money(value, currency, { sign = false } = {}) {
  const n = Number(value || 0)
  const prefix = sign && n > 0 ? '+ ' : ''
  if (currency === 'USD') {
    const s = num(Math.abs(n), 2)
    return `${prefix}${n < 0 ? '− ' : ''}$${nbsp}${s}`
  }
  if (currency && currency !== 'UZS') return `${prefix}${num(n, 2)}${nbsp}${currency}`
  return `${prefix}${num(n)}${nbsp}${t("so'm")}`
}

export function qty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? num(n) : num(n, n * 10 === Math.round(n * 10) ? 1 : 2)
}

export function date(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export function shortDate(iso) {
  if (!iso) return '—'
  const [, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}.${m}`
}

export function pct(v) {
  if (v === null || v === undefined) return '—'
  return `${num(v, Number.isInteger(Number(v)) ? 0 : 1)}%`
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr']
export const WEEKDAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']

export function monthLabel(ym) {
  const [y, m] = ym.split('-')
  return `${t(MONTHS[Number(m) - 1])} ${y}`
}

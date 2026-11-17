// Tillar: uz (lotin, asosiy matn), uz-cyrl (avtomatik transliteratsiya), ru (lug'at).
import RU from './locales/ru.json'

export const LANGS = [
  { code: 'uz', label: "O'zbekcha", short: 'UZ' },
  { code: 'uz-cyrl', label: 'Ўзбекча', short: 'ЎЗ' },
  { code: 'ru', label: 'Русский', short: 'RU' },
]

const LANG_KEY = 'erp.lang'

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return LANGS.some((l) => l.code === v) ? v : 'uz'
  } catch {
    return 'uz'
  }
}

let current = readLang()

export const getLang = () => current

export function setLang(code) {
  try { localStorage.setItem(LANG_KEY, code) } catch { /* ignore */ }
  current = code
}

// ---------------------------------------------------------------- lotin → kirill
const KEEP = new Set(['USD', 'KPI', 'PDF', 'CBU', 'SMS', 'API', 'ERP', 'Akfa', 'MoySklad', 'Excel', 'Django', 'ID', 'MChJ', 'URL', 'RAL'])
const APOS = "['ʻʼ‘’`]"
const MULTI = [
  [new RegExp(`o${APOS}`, 'g'), 'ў'], [new RegExp(`O${APOS}`, 'g'), 'Ў'],
  [new RegExp(`g${APOS}`, 'g'), 'ғ'], [new RegExp(`G${APOS}`, 'g'), 'Ғ'],
  [/sh/g, 'ш'], [/Sh/g, 'Ш'], [/SH/g, 'Ш'],
  [/ch/g, 'ч'], [/Ch/g, 'Ч'], [/CH/g, 'Ч'],
  [/yo/g, 'ё'], [/Yo/g, 'Ё'], [/YO/g, 'Ё'],
  [/yu/g, 'ю'], [/Yu/g, 'Ю'], [/YU/g, 'Ю'],
  [/ya/g, 'я'], [/Ya/g, 'Я'], [/YA/g, 'Я'],
  [/ye/g, 'е'], [/Ye/g, 'Е'], [/YE/g, 'Е'],
]
const SINGLE = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'с', w: 'в',
}

function translitWord(w) {
  if (KEEP.has(w)) return w
  // "USD'da" → "USD'да": qisqartma + qo'shimcha
  const m = w.match(/^([A-Z]{2,})(['ʻʼ‘’`])(.+)$/)
  if (m && KEEP.has(m[1])) return m[1] + m[2] + translitWord(m[3])
  // so'z boshidagi "e" → "э"
  let s = w.replace(/^e/, 'э').replace(/^E/, 'Э')
  for (const [re, rep] of MULTI) s = s.replace(re, rep)
  s = s.replace(new RegExp(`([a-zA-Z])${APOS}`, 'g'), '$1ъ') // tutuq belgisi: ta'sir → таъсир, mas'ul → масъул
  s = s.replace(/[a-zA-Z]/g, (ch) => {
    const low = SINGLE[ch.toLowerCase()]
    if (!low) return ch
    return ch === ch.toLowerCase() ? low : low.toUpperCase()
  })
  return s
}

const cyrlCache = new Map()
export function toCyrillic(text) {
  if (cyrlCache.has(text)) return cyrlCache.get(text)
  // {o'zgaruvchilar}, URL va raqamlar o'zgarmaydi
  const out = text.replace(/\{[^}]*\}|https?:\/\/\S+|[A-Za-zʻʼ‘’'`]+/g, (m) => (m.startsWith('{') || m.startsWith('http') ? m : translitWord(m)))
  cyrlCache.set(text, out)
  return out
}

/** Tarjima: t("Buyurtmalar"), t("{n} kun qoldi", { n: 3 }) */
export function t(text, vars) {
  if (typeof text !== 'string' || !text) return text
  let out = text
  if (current === 'ru') out = RU[text] ?? text
  else if (current === 'uz-cyrl') out = toCyrillic(text)
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
  return out
}

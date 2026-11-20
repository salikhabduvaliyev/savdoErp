// API xatolarini foydalanuvchi tilida ko'rsatish: maydon nomi → yorlig'i, DRF/Django inglizcha xabarlari → o'zbekcha
// (o'zbekcha matn i18n orqali tanlangan tilga, masalan ruschaga, o'giriladi).
import { t } from './i18n'

/** API maydon nomi → foydalanuvchiga ko'rinadigan yorliq */
const FIELDS = {
  amount: 'Summa', order_amount: 'Buyurtma valyutasidagi summa', price: 'Narx', qty: 'Miqdor', quantity: 'Miqdor',
  discount: 'Chegirma', discount_pct: 'Chegirma %', volume: 'Hajm', currency: 'Valyuta', rate: 'Kurs',
  date: 'Sana', plan_date: 'Topshirish muddati', production_date: 'Ishlab chiqarish kuni', month: 'Oy', deadline: 'Muddat',
  trial_ends: 'Sinov tugash sanasi', paid_until: "To'langan muddat",
  client: 'Mijoz', supplier: 'Yetkazuvchi', counterparty: 'Kontragent', manager: 'Menejer', operator: 'Operator',
  employee: 'Xodim', department: "Bo'lim", warehouse: 'Ombor', to_warehouse: 'Qabul qiluvchi ombor', account: 'Hisob (kassa/bank)',
  category: 'Xarajat moddasi', product: 'Mahsulot', material: 'Material', items: 'Pozitsiyalar', materials: 'Materiallar',
  template: "Ko'rsatkich", plan: 'Reja', fact: 'Fakt', process: 'Texjarayon', techcard: 'Texkarta', operation: 'Bosqich',
  output_qty: 'Chiqish miqdori', piece_rate: 'Ishbay stavka', base_salary: 'Oklad', kpi_bonus_base: 'KPI bonus bazasi',
  name: 'Nomi', full_name: 'Ism familiya', username: 'Login', password: 'Parol', old_password: 'Joriy parol',
  new_password: 'Yangi parol', phone: 'Telefon', email: 'Email', role: 'Rol', branch: 'Filial', branches: 'Filiallar',
  code: 'Kod', sku: 'Artikul', barcode: 'Shtrix-kod', unit: 'Birlik', group: 'Guruh', type: 'Turi', kind: 'Turi',
  status: 'Holat', state: 'Status', note: 'Izoh', description: 'Izoh', inn: 'STIR', logo: 'Logo', avatar: 'Rasm',
  min_pct: 'Bajarilish %', coefficient: 'Koeffitsiyent', cap_pct: 'Yuqori chegara', max_users: 'Foydalanuvchilar chegarasi',
  opening_balance: "Boshlang'ich qoldiq", file: 'Fayl', stage: 'Bosqich', sale: 'Sotuv', order: 'Buyurtma',
}

/** DRF / Django standart inglizcha xabarlari → o'zbekcha */
const MESSAGES = [
  [/^This field is required\.?$/i, "To'ldirilishi shart"],
  [/^Ushbu maydon to'ldirilishi shart\.?$/i, "To'ldirilishi shart"],
  [/^This field may not be blank\.?$/i, "Bo'sh bo'lmasligi kerak"],
  [/^This field may not be null\.?$/i, 'Tanlanishi shart'],
  [/^A valid number is required\.?$/i, "Raqam kiriting (masalan: 3 000 yoki 3 000.50)"],
  [/^A valid integer is required\.?$/i, 'Butun son kiriting'],
  [/^Enter a valid email address\.?$/i, "Email noto'g'ri"],
  [/^Date has wrong format\..*/i, "Sana noto'g'ri — kk.oo.yyyy ko'rinishida kiriting"],
  [/^Datetime has wrong format\..*/i, "Sana va vaqt noto'g'ri"],
  [/^Ensure this value is greater than or equal to (.+)\.$/i, (m) => t("{n} dan kichik bo'lmasin", { n: m[1] })],
  [/^Ensure this value is less than or equal to (.+)\.$/i, (m) => t("{n} dan katta bo'lmasin", { n: m[1] })],
  [/^Ensure this field has no more than (\d+) characters\.?$/i, (m) => t('{n} belgidan oshmasin', { n: m[1] })],
  [/^Ensure that there are no more than (\d+) digits in total\.?$/i, (m) => t('Raqam juda katta ({n} xonadan oshmasin)', { n: m[1] })],
  [/^Ensure that there are no more than (\d+) decimal places\.?$/i, (m) => t("Verguldan keyin {n} xonadan oshmasin", { n: m[1] })],
  [/^Invalid pk .* object does not exist\.?$/i, 'Tanlangan qiymat topilmadi (o\'chirilgan bo\'lishi mumkin)'],
  [/^"(.*)" is not a valid choice\.?$/i, (m) => t("«{v}» — noto'g'ri tanlov", { v: m[1] })],
  [/^Not found\.?$/i, 'Topilmadi'],
  [/^You do not have permission to perform this action\.?$/i, "Bu amal uchun huquqingiz yo'q"],
  [/^Authentication credentials were not provided\.?$/i, 'Tizimga qayta kiring'],
  [/^No active account found with the given credentials\.?$/i, "Login yoki parol noto'g'ri"],
  [/^Given token not valid.*/i, 'Sessiya tugadi — qayta kiring'],
  [/^This password is too short.*/i, "Parol juda qisqa (kamida 8 belgi)"],
  [/^This password is too common\.?$/i, 'Parol juda oddiy — murakkabroq tanlang'],
  [/^This password is entirely numeric\.?$/i, "Parol faqat raqamdan iborat bo'lmasin"],
  [/^The password is too similar to the .*/i, "Parol login yoki ismga juda o'xshash"],
  [/^Upload a valid image.*/i, 'Rasm fayli emas'],
  [/^The submitted data was not a file.*/i, 'Fayl tanlanmagan'],
  [/^Expected a list of items.*/i, "Ro'yxat kutilgan"],
  [/^Request failed with status code 5\d\d$/i, 'Serverda xatolik — birozdan keyin qayta urinib ko\'ring'],
  [/^Network Error$/i, "Server bilan aloqa yo'q — internetni tekshiring"],
]

function msg(text) {
  const s = String(text).trim()
  for (const [re, out] of MESSAGES) {
    const m = s.match(re)
    if (m) return typeof out === 'function' ? out(m) : t(out)
  }
  return t(s)
}

const label = (key) => (FIELDS[key] ? t(FIELDS[key]) : key)

/** Xato obyektini "Maydon: xabar" qatorlariga yoyadi (ichma-ich pozitsiyalar ham: "Pozitsiyalar, 2-qator — Miqdor: ...") */
function flatten(data, prefix = '') {
  if (data == null) return []
  if (typeof data === 'string') return [prefix ? `${prefix}: ${msg(data)}` : msg(data)]
  if (Array.isArray(data)) {
    if (data.every((x) => typeof x === 'string')) return [prefix ? `${prefix}: ${data.map(msg).join(' ')}` : data.map(msg).join(' ')]
    return data.flatMap((x, i) => (x && typeof x === 'object' && Object.keys(x).length
      ? flatten(x, `${prefix}${prefix ? ', ' : ''}${t('{n}-qator', { n: i + 1 })}`) : []))
  }
  if (typeof data === 'object') {
    return Object.entries(data).flatMap(([k, v]) => {
      if (k === 'detail' || k === 'non_field_errors' || k === '__all__' || k === 'code') return k === 'code' ? [] : flatten(v, prefix)
      const name = /^\d+$/.test(k) ? t('{n}-qator', { n: Number(k) + 1 }) : label(k) // ichma-ich: {"items": {"0": {...}}}
      return flatten(v, prefix ? `${prefix} — ${name}` : name)
    })
  }
  return [String(data)]
}

export function localizeError(err) {
  const data = err?.response?.data
  if (!data) return msg(err?.message || 'Xatolik')
  if (typeof data === 'string') {
    if (/^\s*</.test(data)) return msg(`Request failed with status code ${err.response.status}`)
    return msg(data.slice(0, 200))
  }
  const lines = flatten(data)
  return lines.length ? lines.join('; ') : t('Xatolik')
}

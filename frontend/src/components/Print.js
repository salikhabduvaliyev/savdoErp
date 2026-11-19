// Chop etish shakllari (MoySklad "Печать"): yuk xati (nakladnoy), tovar cheki — alohida oynada, brauzer orqali chop etiladi
import api from '../api'
import { date, money, qty } from '../format'
import { t } from '../i18n'

export const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const BASE_CSS = `
  * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 4px; } .muted { color: #555; } .row { display: flex; justify-content: space-between; gap: 24px; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; } th, td { border: 1px solid #333; padding: 5px 7px; }
  th { background: #f1f1f1; } .num { text-align: right; white-space: nowrap; } .tot td { font-weight: bold; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; } .sign div { width: 45%; border-top: 1px solid #333; padding-top: 4px; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
`

export function openPrint(title, body, css = BASE_CSS, autoPrint = true) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) { alert(t("Brauzer yangi oynani blokladi — ruxsat bering")); return }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>
    <div class="noprint" style="margin-bottom:12px"><button onclick="window.print()">🖨 ${esc(t('Chop etish'))}</button></div>${body}</body></html>`)
  w.document.close()
  if (autoPrint) setTimeout(() => w.print(), 300)
}

async function company() {
  try { return (await api.get('/core/company/')).data } catch { return {} }
}

/** Yuk xati (nakladnoy) — sotuv uchun */
export async function printWaybill(s) {
  const c = await company()
  const rows = s.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="num">${qty(i.qty)}</td><td>${esc(t(i.unit || ''))}</td>
    <td class="num">${money(i.price, s.currency)}</td><td class="num">${Number(i.discount_pct) ? qty(i.discount_pct) + '%' : '—'}</td><td class="num">${money(i.amount, s.currency)}</td></tr>`).join('')
  openPrint(`${t('Yuk xati')} №${s.number}`, `
    <h1>${esc(t('Yuk xati (nakladnoy)'))} №${s.number} ${esc(t('dan'))} ${date(s.date)}</h1>
    <div class="row">
      <div><b>${esc(t('Yetkazib beruvchi'))}:</b> ${esc(c.legal_name || c.name || '')}<br>${c.inn ? `${esc(t('STIR'))}: ${esc(c.inn)}<br>` : ''}${esc(c.address || '')}<br>${esc(c.phone || '')}</div>
      <div><b>${esc(t('Qabul qiluvchi'))}:</b> ${esc(s.client_name)}<br>${s.warehouse_name ? `${esc(t('Ombor'))}: ${esc(s.warehouse_name)}` : ''}</div>
    </div>
    <table><thead><tr><th>№</th><th>${esc(t('Nomi'))}</th><th>${esc(t('Miqdor'))}</th><th>${esc(t('Birlik'))}</th><th>${esc(t('Narx'))}</th><th>${esc(t('Chegirma'))}</th><th>${esc(t('Summa'))}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${Number(s.discount) ? `<tr><td colspan="6">${esc(t('Chegirma'))}</td><td class="num">− ${money(s.discount, s.currency)}</td></tr>` : ''}
      <tr class="tot"><td colspan="6">${esc(t('Jami'))}</td><td class="num">${money(s.total, s.currency)}</td></tr></tfoot></table>
    <p>${esc(t('Jami pozitsiyalar'))}: ${s.items.length}</p>
    <div class="sign"><div>${esc(t('Topshirdi'))}</div><div>${esc(t('Qabul qildi'))}</div></div>`)
}

/** Tovar cheki — tor (80 mm) chek */
export async function printReceipt(s) {
  const c = await company()
  const rows = s.items.map((i) => `<div class="it"><div>${esc(i.name)}</div><div class="r"><span>${qty(i.qty)} × ${money(i.price, s.currency)}</span><b>${money(i.amount, s.currency)}</b></div></div>`).join('')
  openPrint(`${t('Tovar cheki')} №${s.number}`, `
    <div class="c"><b>${esc(c.name || '')}</b><br>${esc(c.address || '')}<br>${esc(c.phone || '')}</div><hr>
    <div>${esc(t('Chek'))} №${s.number} · ${date(s.date)}<br>${esc(t('Mijoz'))}: ${esc(s.client_name)}</div><hr>${rows}<hr>
    ${Number(s.discount) ? `<div class="r"><span>${esc(t('Chegirma'))}</span><b>− ${money(s.discount, s.currency)}</b></div>` : ''}
    <div class="r big"><span>${esc(t('Jami'))}</span><b>${money(s.total, s.currency)}</b></div>
    <div class="r"><span>${esc(t("To'langan"))}</span><span>${money(s.paid, s.currency)}</span></div><hr><div class="c">${esc(t('Xaridingiz uchun rahmat!'))}</div>`,
  `body{font-family:monospace;width:72mm;margin:4mm;font-size:12px} .c{text-align:center} .r{display:flex;justify-content:space-between;gap:8px}
   .it{margin:4px 0} .big{font-size:15px;margin-top:4px} hr{border:0;border-top:1px dashed #000} @media print{.noprint{display:none}}`)
}

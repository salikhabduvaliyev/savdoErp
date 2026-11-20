import{q as c,t as a,m as r,d as s,b as l}from"./index-Bv-i0Xi5.js";const t=n=>String(n??"").replace(/[&<>"]/g,i=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[i]),$=`
  * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 4px; } .muted { color: #555; } .row { display: flex; justify-content: space-between; gap: 24px; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; } th, td { border: 1px solid #333; padding: 5px 7px; }
  th { background: #f1f1f1; } .num { text-align: right; white-space: nowrap; } .tot td { font-weight: bold; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; } .sign div { width: 45%; border-top: 1px solid #333; padding-top: 4px; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
`;function p(n,i,o=$,e=!0){const d=window.open("","_blank","width=900,height=1000");if(!d){alert(a("Brauzer yangi oynani blokladi — ruxsat bering"));return}d.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t(n)}</title><style>${o}</style></head><body>
    <div class="noprint" style="margin-bottom:12px"><button onclick="window.print()">🖨 ${t(a("Chop etish"))}</button></div>${i}</body></html>`),d.document.close(),e&&setTimeout(()=>d.print(),300)}async function m(){try{return(await l.get("/core/company/")).data}catch{return{}}}async function b(n){const i=await m(),o=n.items.map((e,d)=>`<tr><td>${d+1}</td><td>${t(e.name)}</td><td class="num">${c(e.qty)}</td><td>${t(a(e.unit||""))}</td>
    <td class="num">${r(e.price,n.currency)}</td><td class="num">${Number(e.discount_pct)?c(e.discount_pct)+"%":"—"}</td><td class="num">${r(e.amount,n.currency)}</td></tr>`).join("");p(`${a("Yuk xati")} №${n.number}`,`
    <h1>${t(a("Yuk xati (nakladnoy)"))} №${n.number} ${t(a("dan"))} ${s(n.date)}</h1>
    <div class="row">
      <div><b>${t(a("Yetkazib beruvchi"))}:</b> ${t(i.legal_name||i.name||"")}<br>${i.inn?`${t(a("STIR"))}: ${t(i.inn)}<br>`:""}${t(i.address||"")}<br>${t(i.phone||"")}</div>
      <div><b>${t(a("Qabul qiluvchi"))}:</b> ${t(n.client_name)}<br>${n.warehouse_name?`${t(a("Ombor"))}: ${t(n.warehouse_name)}`:""}</div>
    </div>
    <table><thead><tr><th>№</th><th>${t(a("Nomi"))}</th><th>${t(a("Miqdor"))}</th><th>${t(a("Birlik"))}</th><th>${t(a("Narx"))}</th><th>${t(a("Chegirma"))}</th><th>${t(a("Summa"))}</th></tr></thead>
    <tbody>${o}</tbody>
    <tfoot>${Number(n.discount)?`<tr><td colspan="6">${t(a("Chegirma"))}</td><td class="num">− ${r(n.discount,n.currency)}</td></tr>`:""}
      <tr class="tot"><td colspan="6">${t(a("Jami"))}</td><td class="num">${r(n.total,n.currency)}</td></tr></tfoot></table>
    <p>${t(a("Jami pozitsiyalar"))}: ${n.items.length}</p>
    <div class="sign"><div>${t(a("Topshirdi"))}</div><div>${t(a("Qabul qildi"))}</div></div>`)}async function h(n){const i=await m(),o=n.items.map(e=>`<div class="it"><div>${t(e.name)}</div><div class="r"><span>${c(e.qty)} × ${r(e.price,n.currency)}</span><b>${r(e.amount,n.currency)}</b></div></div>`).join("");p(`${a("Tovar cheki")} №${n.number}`,`
    <div class="c"><b>${t(i.name||"")}</b><br>${t(i.address||"")}<br>${t(i.phone||"")}</div><hr>
    <div>${t(a("Chek"))} №${n.number} · ${s(n.date)}<br>${t(a("Mijoz"))}: ${t(n.client_name)}</div><hr>${o}<hr>
    ${Number(n.discount)?`<div class="r"><span>${t(a("Chegirma"))}</span><b>− ${r(n.discount,n.currency)}</b></div>`:""}
    <div class="r big"><span>${t(a("Jami"))}</span><b>${r(n.total,n.currency)}</b></div>
    <div class="r"><span>${t(a("To'langan"))}</span><span>${r(n.paid,n.currency)}</span></div><hr><div class="c">${t(a("Xaridingiz uchun rahmat!"))}</div>`,`body{font-family:monospace;width:72mm;margin:4mm;font-size:12px} .c{text-align:center} .r{display:flex;justify-content:space-between;gap:8px}
   .it{margin:4px 0} .big{font-size:15px;margin-top:4px} hr{border:0;border-top:1px dashed #000} @media print{.noprint{display:none}}`)}export{h as a,t as e,p as o,b as p};

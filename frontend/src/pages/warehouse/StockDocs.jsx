// Ombor va xarid hujjatlari — MoySklad uslubida: ro'yxat (filtr bilan) va hujjat sahifasi
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, canPost, useAuth } from '../../auth'
import { cleanNum, DocField, DocFooter, DocPage, DocTitle, newKey, Positions, useLinesTotal } from '../../components/DocEditor'
import Icon from '../../components/Icon'
import { Badge, Loading, Modal, MoneyBag, toast, useFetch } from '../../components/ui'
import { downloadFile } from '../../components/Download'
import { convertPrice, CurrencyOptions, curLabel, baseCurrency } from '../../currency'
import { date, money, qty, todayISO } from '../../format'
import { t } from '../../i18n'
import { DropMenu, SearchSelect, usePager } from '../../components/Controls'
import { confirmDialog, promptDialog } from '../../components/Confirm'
import { DateInput } from '../../components/Inputs'

/* Hujjat turlari sozlamasi */
export const DOC_TYPES = {
  purchase_order: { title: 'Yetkazuvchiga buyurtmalar', one: 'Yetkazuvchiga buyurtma', party: 'Yetkazuvchi', wh: 'Ombor', price: true, planDate: true,
    derive: [['supply', 'Qabul qilish']], module: 'purchase_orders', postedLabel: 'Tasdiqlangan', search: {} },
  supply: { title: 'Qabul qilishlar', one: 'Qabul qilish', party: 'Yetkazuvchi', wh: 'Ombor', price: true,
    derive: [['purchase_return', 'Yetkazuvchiga qaytarish']], module: 'supplies', search: {} },
  purchase_return: { title: 'Yetkazuvchiga qaytarishlar', one: 'Yetkazuvchiga qaytarish', party: 'Yetkazuvchi', wh: 'Qaysi ombordan', price: true,
    module: 'purchase_returns', short: true, search: {} },
  enter: { title: 'Kirimlar', one: 'Kirim', wh: 'Ombor', price: true, discount: false, module: 'stock_enter', search: {},
    hint: "Kirim (MoySklad: Оприходование) — yetkazuvchisiz kirim: ortiqcha chiqqan tovar, boshlang'ich qoldiq." },
  loss: { title: 'Hisobdan chiqarishlar', one: 'Hisobdan chiqarish', wh: 'Qaysi ombordan', price: false, module: 'stock_loss', short: true, search: {},
    hint: "Hisobdan chiqarish (Списание) — brak, yo'qotish, ichki ehtiyoj. Tannarx bo'yicha chiqim." },
  move: { title: "Ko'chirishlar", one: "Ko'chirish", wh: 'Qaysi ombordan', toWh: true, price: false, module: 'stock_move', short: true, search: {} },
  inventory: { title: 'Inventarizatsiyalar', one: 'Inventarizatsiya', wh: 'Ombor', price: false, inventory: true, module: 'stock_inventory', search: {},
    hint: "Haqiqiy (sanalgan) miqdorni kiriting — o'tkazilganda farq qoldiqqa yoziladi." },
  sales_return: { title: 'Mijoz qaytarishlari', one: 'Mijoz qaytarishi', party: 'Mijoz', wh: 'Qaysi omborga', price: true, module: 'sales_returns', search: { for_sale: 1 } },
}

const pad = (n) => String(n ?? '').padStart(5, '0')

/* ------------------------------------------------------------ hujjat sahifasi */
export function StockDocForm({ type: type0, id: id0, onClose, onSaved, onOpen }) {
  const { user } = useAuth()
  const [docId, setDocId] = useState(id0 || null)
  const loaded = useFetch(docId ? `/warehouse/docs/${docId}/` : null, { type: type0 })
  const [doc, setDoc] = useState(null)
  const type = doc?.type || type0
  const cfg = DOC_TYPES[type]
  const warehouses = useFetch('/warehouse/warehouses/')
  const parties = useFetch(cfg.party ? '/crm/counterparties/' : null, { is_active: true })
  const [v, setV] = useState(null)
  const [lines, setLines] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const stockMap = useFetch(v?.warehouse ? '/warehouse/stock/' : null, { warehouse: v?.warehouse })
  const fileRef = useRef(null)
  const [imp, setImp] = useState(null)
  const editable = docId ? canEdit(user, cfg.module) : canCreate(user, cfg.module)

  const fill = (d) => {
    setDoc(d)
    setV({
      date: d.date, warehouse: d.warehouse || '', to_warehouse: d.to_warehouse || '', counterparty: d.counterparty || '',
      currency: d.currency, posted: d.posted, plan_date: d.plan_date || '', note: d.note || '',
    })
    setLines((d.items || []).map((i) => ({
      key: newKey(), product: i.material, name: i.material_name, code: i.material_code || '', unit: i.unit,
      qty: cleanNum(i.qty), price: cleanNum(i.price), discount_pct: cleanNum(i.discount_pct), stock: null, book: i.book_qty,
    })))
    setDirty(false)
  }
  useEffect(() => { if (loaded.data) fill(loaded.data) }, [loaded.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!docId && !v) {
      setV({ date: todayISO(), warehouse: '', to_warehouse: '', counterparty: '', currency: baseCurrency(), posted: true, plan_date: '', note: '' })
    }
  }, [docId, v])
  useEffect(() => {
    if (!docId && v && !v.warehouse && warehouses.data?.length) setV((s) => ({ ...s, warehouse: warehouses.data[0].id }))
  }, [warehouses.data, v, docId])

  // ombordagi qoldiq (tanlangan ombor bo'yicha)
  const stockBy = useMemo(() => {
    const m = {}
    for (const s of stockMap.data?.results || []) m[s.material] = s.qty
    return m
  }, [stockMap.data])
  const linesView = useMemo(() => lines.map((l) => ({ ...l, stock: l.product ? (stockBy[l.product] ?? 0) : null })), [lines, stockBy])
  const total = useLinesTotal(lines)

  if (!v || (docId && !doc)) return <DocPage onClose={onClose} toolbar={<button className="btn" onClick={onClose}>{t('Yopish')}</button>}><Loading error={loaded.error} /></DocPage>

  const set = (k, val) => { setV((s) => ({ ...s, [k]: val })); setDirty(true) }
  const setL = (fn) => { setLines(fn); setDirty(true) }
  // tovar narxi o'z valyutasida → hujjat valyutasiga (joriy kurs bo'yicha)
  const priceOf = (p) => {
    if (type === 'sales_return') {
      const pt = Object.keys(p.prices || {})[0]
      return pt ? convertPrice(p.prices[pt], p.currency, v.currency) : ''
    }
    return convertPrice(p.purchase_price, p.currency, v.currency)
  }
  const changeCurrency = (to) => {
    setLines((ls) => ls.map((l) => ({ ...l, price: l.price === '' ? '' : String(convertPrice(l.price, v.currency, to)) })))
    set('currency', to)
  }

  const save = async (close, extra = {}) => {
    setBusy(true)
    setError(null)
    const items = lines.filter((l) => l.product).map((l) => ({
      material: l.product, qty: l.qty || 0, ...(cfg.price ? { price: l.price || 0, discount_pct: l.discount_pct || 0 } : {}),
    }))
    const payload = {
      type, ...v, ...extra, items, warehouse: v.warehouse || null, to_warehouse: v.to_warehouse || null,
      counterparty: v.counterparty || null, plan_date: v.plan_date || null,
    }
    try {
      const { data } = docId ? await api.patch(`/warehouse/docs/${docId}/?type=${type}`, payload) : await api.post(`/warehouse/docs/?type=${type}`, payload)
      setDocId(data.id)
      fill(data)
      setChanged(true)
      toast(t('Saqlandi'))
      if (close) onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const togglePosted = async () => {
    if (!docId) { set('posted', !v.posted); return }
    if (dirty) return save(false, { posted: !v.posted })
    setBusy(true)
    try {
      const { data } = await api.post(`/warehouse/docs/${docId}/${v.posted ? 'unpost' : 'post'}/?type=${type}`)
      fill(data)
      setChanged(true)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const derive = async (target) => {
    if (dirty) { toast(t('Avval saqlang'), true); return }
    try {
      const { data } = await api.post(`/warehouse/docs/${docId}/derive/?type=${type}`, { type: target })
      toast(t('{d} yaratildi — tekshirib saqlang', { d: t(DOC_TYPES[target].one) }))
      onOpen ? onOpen(data.id, target) : onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  const remove = async () => {
    if (!await confirmDialog(t("Hujjat o'chirilsinmi?") + (v.posted ? `\n${t("Qoldiqlar qaytariladi.")}` : ''))) return
    try { await api.delete(`/warehouse/docs/${docId}/?type=${type}`); toast(t("O'chirildi")); onSaved() } catch (err) { setError(errorText(err)) }
  }
  const close = async () => {
    if (dirty && !await confirmDialog(t("Saqlanmagan o'zgarishlar bor. Yopilsinmi?"))) return
    if (changed) onSaved()
    else onClose()
  }
  const fillFromStock = () => {
    const rows = stockMap.data?.results || []
    setL((ls) => {
      const have = new Set(ls.map((l) => String(l.product)))
      const add = rows.filter((s) => !have.has(String(s.material))).map((s) => ({
        key: newKey(), product: s.material, name: s.material_name, code: '', unit: s.unit, qty: cleanNum(s.qty), price: '', discount_pct: '0',
      }))
      return [...ls, ...add]
    })
  }

  /* Excel/CSV import (MoySklad "Импорт"): fayl serverda o'qiladi, pozitsiyalar formaga qo'shiladi (saqlash — foydalanuvchida) */
  const importFile = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post(`/warehouse/docs/import_items/?type=${type}`, fd)
      setL((ls) => {
        const out = [...ls]
        data.lines.forEach((x) => {
          const i = out.findIndex((l) => String(l.product) === String(x.material))
          const price = x.price != null ? cleanNum(x.price) : (cfg.price ? String(priceOf({ purchase_price: x.purchase_price, currency: x.currency, prices: {} })) : '')
          if (i >= 0) out[i] = { ...out[i], qty: cleanNum(Number(out[i].qty || 0) + Number(x.qty)), ...(x.price != null ? { price } : {}) }
          else out.push({ key: newKey(), product: x.material, name: x.name, code: x.code || '', unit: x.unit, qty: cleanNum(x.qty), price, discount_pct: '0', stock: null })
        })
        return out
      })
      setImp({ name: file.name, added: data.lines.length, errors: data.errors })
    } catch (e) { toast(errorText(e), true) }
    if (fileRef.current) fileRef.current.value = ''
  }

  const whs = warehouses.data || []
  const canSave = editable && !busy && (!cfg.party || v.counterparty) && (cfg.planDate || v.warehouse) && (!cfg.toWh || v.to_warehouse)
  const postedLabel = cfg.postedLabel || "O'tkazilgan"

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button type="button" className="btn primary" disabled={!canSave} onClick={() => save(false)}><Icon name="save" size={16} /> {busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        <button type="button" className="btn" disabled={!canSave} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>
        <button type="button" className="btn" onClick={close}>{t('Yopish')}</button>
        {editable && (
          <DropMenu label={t('Import')} icon="upload" items={[
            [t("Excel'dan import (.xlsx, .csv)"), () => fileRef.current?.click()],
            [t('Shablonni yuklab olish'), () => downloadFile('/warehouse/docs/import_template/', { type }, `shablon-${type}.xlsx`)],
          ]} />
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => importFile(e.target.files[0])} />
        {docId && cfg.derive?.map(([k, l]) => (
          <button key={k} type="button" className="btn" onClick={() => derive(k)} disabled={!canCreate(user, DOC_TYPES[k].module)}>
            <Icon name="plus" size={15} /> {t(l)}
          </button>
        ))}
        <span className="grow" />
        {dirty && <span className="small muted">{t("Saqlanmagan o'zgarishlar")}</span>}
        <label className="check posted-check" title={t('Belgilansa — qoldiqqa ta\'sir qiladi')}>
          <input type="checkbox" checked={!!v.posted} onChange={togglePosted} disabled={!editable || busy || !canPost(user, cfg.module)} /> {t(postedLabel)}
        </label>
        {docId && canDelete(user, cfg.module) && <button type="button" className="icon-act danger" title={t("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
      </>}
    >
      <DocTitle label={cfg.one} number={doc ? pad(doc.number) : null} date={v.date} onDate={editable ? (d) => set('date', d) : null}>
        {doc && (doc.posted ? <Badge kind="ok">{t(postedLabel)}</Badge> : <Badge kind="draft">{t('Qoralama')}</Badge>)}
        {doc?.source_number && <span className="muted small">{t('Asos')}: {t(DOC_TYPES[doc.source_type]?.one || '')} №{pad(doc.source_number)}</span>}
        {doc?.sale_number && <span className="muted small">{t('Sotuv')} №{doc.sale_number}</span>}
      </DocTitle>
      {error && <div className="error">{error}</div>}
      {cfg.hint && !docId && <div className="hint" style={{ marginBottom: 10 }}>{t(cfg.hint)}</div>}

      <div className="doc-grid">
        <div>
          {cfg.party && (
            <DocField label={cfg.party} required>
              <SearchSelect value={v.counterparty || ''} onChange={(id) => set('counterparty', id)} disabled={!editable}
                options={(parties.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.phone }))}
                onCreate={async (name) => {
                  const n = name || await promptDialog(t('Yangi kontragent nomi'))
                  if (!n) return
                  try { const { data } = await api.post('/crm/counterparties/', { name: n }); parties.reload(); set('counterparty', data.id) } catch (e) { setError(errorText(e)) }
                }} createLabel={t('Yangi kontragent')} />
            </DocField>
          )}
          <DocField label={cfg.wh} required={!cfg.planDate}>
            <SearchSelect value={v.warehouse || ''} onChange={(id) => set('warehouse', id)} disabled={!editable} options={whs.map((w) => ({ value: w.id, label: w.name }))} />
          </DocField>
          {cfg.toWh && (
            <DocField label="Qaysi omborga" required>
              <SearchSelect value={v.to_warehouse || ''} onChange={(id) => set('to_warehouse', id)} disabled={!editable}
                options={whs.filter((w) => String(w.id) !== String(v.warehouse)).map((w) => ({ value: w.id, label: w.name }))} />
            </DocField>
          )}
        </div>
        <div>
          {cfg.price && (
            <DocField label="Valyuta" required>
              <select value={v.currency} onChange={(e) => changeCurrency(e.target.value)} disabled={!editable}><CurrencyOptions withName value={v.currency} /></select>
            </DocField>
          )}
          {cfg.planDate && <DocField label="Kutilgan sana"><DateInput value={v.plan_date || ''} onChange={(e) => set('plan_date', e.target.value)} disabled={!editable} /></DocField>}
        </div>
        <div>
          {doc?.created_by_name && <DocField label="Muallif"><input value={doc.created_by_name} readOnly className="muted-input" /></DocField>}
        </div>
      </div>

      <div className="doc-tabs">
        <span className="active">{t('Pozitsiyalar')}</span>
        {cfg.inventory && editable && v.warehouse && <button type="button" className="btn small" style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={fillFromStock}>
          <Icon name="download" size={15} /> {t("Ombordagi barcha tovarlarni qo'shish")}</button>}
      </div>
      <Positions
        lines={linesView} setLines={setL} currency={v.currency} readOnly={!editable} allowFree={false} searchParams={cfg.search}
        priceOf={cfg.price ? priceOf : null}
        stockOf={(p) => stockBy[p.id] ?? 0}
        showPrice={cfg.price} showDiscount={cfg.discount !== false}
        qtyLabel={cfg.inventory ? 'Haqiqiy' : 'Miqdor'} stockLabel={cfg.inventory ? 'Hisobda' : 'Qoldiq'}
        warnShort={!!cfg.short}
        extraCols={cfg.inventory ? {
          head: <th className="num" style={{ width: 100 }}>{t('Farq')}</th>,
          cell: (l) => {
            const book = doc?.posted && l.book !== null && l.book !== undefined ? Number(l.book) : Number(l.stock || 0)
            const d = Number(l.qty || 0) - book
            return <td className={'num bold ' + (d > 0 ? 'green' : d < 0 ? 'red' : 'muted')}>{d > 0 ? '+' : ''}{qty(d)}</td>
          },
        } : null}
      />

      <DocFooter
        comment={v.note}
        onComment={editable ? (note) => set('note', note) : null}
        rows={cfg.price ? [['Pozitsiyalar', lines.length], ['Jami', money(total, v.currency), true]] : [['Pozitsiyalar', lines.length], ['Jami miqdor', qty(lines.reduce((a, l) => a + Number(l.qty || 0), 0)), true]]}
      />
      {imp && (
        <Modal dialog title={t('Import natijasi')} onClose={() => setImp(null)}>
          <p style={{ marginTop: 0 }}><b>{imp.name}</b></p>
          <p className="green">{t("Qo'shildi: {n} ta pozitsiya", { n: imp.added })}</p>
          {imp.errors.length > 0 && <>
            <p className="red" style={{ marginBottom: 0 }}>{t('Xatoliklar: {n} ta qator', { n: imp.errors.length })}</p>
            <ul className="doc-import-err">{imp.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </>}
          <p className="muted small">{t("Pozitsiyalarni tekshirib, hujjatni saqlang.")}</p>
          <div className="form-actions"><button className="btn primary" onClick={() => setImp(null)}>{t('OK')}</button></div>
        </Modal>
      )}
    </DocPage>
  )
}

/* ------------------------------------------------------------ ro'yxat */
export function DocList({ type }) {
  const { user } = useAuth()
  const cfg = DOC_TYPES[type]
  const [params, setParams] = useSearchParams()
  const [stamp, setStamp] = useState(0)
  const [showFilter, setShowFilter] = useState(false)
  const empty = { date_from: '', date_to: '', warehouse: '', counterparty: '', posted: '', search: '' }
  const [f, setF] = useState(empty)
  const [applied, setApplied] = useState(empty)
  const q = useMemo(() => Object.fromEntries(Object.entries({ ...applied, type, stamp }).filter(([, x]) => x !== '')), [applied, type, stamp])
  const { data, error } = useFetch('/warehouse/docs/', q)
  const { rows: pageRows, pager } = usePager(data?.results, 50, JSON.stringify(q))
  const warehouses = useFetch('/warehouse/warehouses/')
  const parties = useFetch(cfg.party ? '/crm/counterparties/' : null, { is_active: true })
  const open = params.get('open')
  const openType = params.get('otype') || type
  const setOpen = (id, otype) => {
    const p = new URLSearchParams(params)
    if (id) { p.set('open', id); if (otype && otype !== type) p.set('otype', otype); else p.delete('otype') } else { p.delete('open'); p.delete('otype') }
    setParams(p)
  }
  const reload = () => setStamp((s) => s + 1)
  const period = (days) => {
    const to = todayISO()
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    setF({ ...f, date_from: days === 0 ? to : from, date_to: to })
  }

  return (
    <>
      <div className="page-head">
        <h1>{t(cfg.title)}</h1>
        {canCreate(user, cfg.module) && <button className="btn primary" onClick={() => setOpen('new')}><Icon name="plus" size={16} /> {t(cfg.one)}</button>}
        <button className={'btn' + (showFilter ? ' active' : '')} onClick={() => setShowFilter((s) => !s)}><Icon name="filter" size={15} /> {t('Filtr')}</button>
        <span className="grow" />
        <div className="psearch" style={{ maxWidth: 320, minWidth: 220 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={t('Raqam yoki izoh')} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && setApplied({ ...f })} />
        </div>
      </div>

      {showFilter && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{t('Davr')}
              <div className="period-links">
                <button type="button" className="link-btn" onClick={() => period(0)}>{t('bugun')}</button>·
                <button type="button" className="link-btn" onClick={() => period(7)}>{t('hafta')}</button>·
                <button type="button" className="link-btn" onClick={() => period(30)}>{t('oy')}</button>
              </div>
              <div className="inline-pick"><DateInput value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />—<DateInput value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></div>
            </label>
            <label>{t('Ombor')}
              <select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
                <option value="">{t('hammasi')}</option>
                {(warehouses.data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            {cfg.party && (
              <label>{t(cfg.party)}
                <SearchSelect value={f.counterparty} onChange={(id) => setF({ ...f, counterparty: id })} empty={t('hammasi')}
                  options={(parties.data || []).map((c) => ({ value: c.id, label: c.name }))} />
              </label>
            )}
            <label>{t(cfg.postedLabel || "O'tkazilgan")}
              <select value={f.posted} onChange={(e) => setF({ ...f, posted: e.target.value })}>
                <option value="">{t('hammasi')}</option><option value="1">{t('ha')}</option><option value="0">{t("yo'q (qoralama)")}</option>
              </select>
            </label>
          </div>
          <div className="filter-actions">
            <button className="btn primary" onClick={() => setApplied({ ...f })}>{t('Topish')}</button>
            <button className="btn" onClick={() => { setF(empty); setApplied(empty) }}>{t('Tozalash')}</button>
          </div>
        </div>
      )}

      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <div className="table-toolbar"><b>{t('Hammasi')} {data.count}</b></div>
          <table className="t">
            <thead>
              <tr>
                <th>№</th><th>{t('Sana')}</th>
                <th>{t(cfg.toWh ? 'Qaysi ombordan' : cfg.wh)}</th>
                {cfg.toWh && <th>{t('Qaysi omborga')}</th>}
                {cfg.party && <th>{t(cfg.party)}</th>}
                {cfg.price ? <th className="num">{t('Summa')}</th> : <th className="num">{t('Pozitsiyalar')}</th>}
                {cfg.price && <th>{t('Valyuta')}</th>}
                <th>{t(cfg.postedLabel || "O'tkazilgan")}</th>
                {cfg.planDate && <th>{t('Kutilgan sana')}</th>}
                <th>{t('Izoh')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                  <td><span className="link-like">{pad(d.number)}</span></td>
                  <td>{date(d.date)}</td>
                  <td>{d.warehouse_name || '—'}</td>
                  {cfg.toWh && <td>{d.to_warehouse_name || '—'}</td>}
                  {cfg.party && <td>{d.counterparty_name || '—'}</td>}
                  {cfg.price ? <td className="num bold">{money(d.total, d.currency)}</td> : <td className="num">{d.items_count}</td>}
                  {cfg.price && <td>{curLabel(d.currency)}</td>}
                  <td>{d.posted ? <Badge kind="ok">{t('ha')}</Badge> : <Badge kind="draft">{t('qoralama')}</Badge>}</td>
                  {cfg.planDate && <td>{date(d.plan_date)}</td>}
                  <td className="small muted ellipsis">{d.note}</td>
                </tr>
              ))}
              {!data.results.length && <tr><td colSpan={10} className="empty">{t("Hujjatlar yo'q")}</td></tr>}
            </tbody>
            {cfg.price && data.results.length > 0 && (
              <tfoot><tr><td colSpan={cfg.party ? 4 : 3}>{t('Jami (valyuta bo\'yicha)')}</td><td className="num"><MoneyBag bag={data.totals} /></td><td colSpan={5} /></tr></tfoot>
            )}
          </table>
          {pager}
        </div>
      )}
      {cfg.hint && <p className="hint">{t(cfg.hint)}</p>}

      {open && (
        <StockDocForm
          key={open + openType}
          type={openType}
          id={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); reload() }}
          onOpen={(id, otype) => { reload(); setOpen(id, otype) }}
        />
      )}
    </>
  )
}

// Tovarlar va xizmatlar — MoySklad uslubida: chapda guruhlar daraxti, o'ngda jadval, tovar — to'liq sahifada
import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { cleanNum, DocPage } from '../../components/DocEditor'
import { usePager } from '../../components/Controls'
import EntityForm from '../../components/EntityForm'
import Icon, { IconBtn } from '../../components/Icon'
import { Badge, Field, Loading, Modal, toast, useFetch } from '../../components/ui'
import { curLabel, CurrencyOptions, currencyOptions, baseCurrency } from '../../currency'
import { date, money, qty } from '../../format'
import { t } from '../../i18n'
import { confirmDialog } from '../../components/Confirm'

// eslint-disable-next-line react-refresh/only-export-components
export const PRODUCT_TYPES = [
  ['goods', t("Tovar (qayta sotish)")],
  ['product', t("Tayyor mahsulot")],
  ['raw', t("Xomashyo / material")],
  ['service', t("Xizmat")],
]
const TYPE_BADGE = { raw: 'neutral', product: 'confirmed', goods: 'in_production', service: 'ready' }
const UNITS = [['pcs', t("dona")], ['m', 'm'], ['m2', 'm²'], ['kg', t("kg")], ['set', t("to'plam")]]

/* ------------------------------------------------------------ guruh formasi */
function GroupForm({ item, groups, parent, onClose, onSaved }) {
  const [v, setV] = useState({ name: item?.name || '', parent: item?.parent ?? parent ?? '' })
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...v, parent: v.parent || null }
      item ? await api.patch(`/warehouse/groups/${item.id}/`, payload) : await api.post('/warehouse/groups/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={item ? item.name : t('Yangi guruh')} onClose={onClose} dialog>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        <Field label="Nomi" full><input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
        <Field label="Ota guruh" full>
          <select value={v.parent || ''} onChange={(e) => setV({ ...v, parent: e.target.value })}>
            <option value="">{t('— yuqori daraja —')}</option>
            {groups.filter((g) => g.id !== item?.id).map((g) => <option key={g.id} value={g.id}>{'  '.repeat(g.depth)}{g.name}</option>)}
          </select>
        </Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary"><Icon name="save" size={16} /> {t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Guruhlar ro'yxatini daraxt tartibiga keltirish: [{...g, depth}] */
function flatTree(groups) {
  const by = {}
  for (const g of groups) (by[g.parent || 0] ||= []).push(g)
  const out = []
  const walk = (pid, depth) => (by[pid] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach((g) => { out.push({ ...g, depth }); walk(g.id, depth + 1) })
  walk(0, 0)
  return out
}

function GroupTree({ groups, value, onPick, editable, onEdit, onDelete }) {
  const tree = useMemo(() => flatTree(groups), [groups])
  const [closed, setClosed] = useState({})
  const hasKids = (id) => groups.some((g) => g.parent === id)
  const hidden = (g) => {
    let p = g.parent
    while (p) {
      if (closed[p]) return true
      p = groups.find((x) => x.id === p)?.parent
    }
    return false
  }
  return (
    <div className="group-tree card">
      <button className={'gt-item' + (!value ? ' active' : '')} onClick={() => onPick('')}>
        <Icon name="products" size={16} /> {t('Tovarlar va xizmatlar')}
      </button>
      {tree.filter((g) => !hidden(g)).map((g) => (
        <div key={g.id} className={'gt-row' + (String(value) === String(g.id) ? ' active' : '')} style={{ paddingLeft: 8 + g.depth * 16 }}>
          {hasKids(g.id)
            ? <button className="gt-toggle" onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}><Icon name={closed[g.id] ? 'chevron-right' : 'chevron-down'} size={14} /></button>
            : <span className="gt-toggle" />}
          <button className="gt-item" onClick={() => onPick(g.id)}>{g.name} <span className="muted small">{g.products_count || ''}</span></button>
          {editable && <span className="gt-acts"><IconBtn icon="edit" size={14} title="Tahrirlash" onClick={() => onEdit(g)} /><IconBtn icon="delete" size={14} danger title="O'chirish" onClick={() => onDelete(g)} /></span>}
        </div>
      ))}
      <button className={'gt-item muted' + (value === 'none' ? ' active' : '')} onClick={() => onPick('none')}>{t('Guruhsiz')}</button>
    </div>
  )
}

/* ------------------------------------------------------------ tovar sahifasi */
function ProductPage({ id: id0, newType, defaults, groups, priceTypes, onClose, onSaved }) {
  const { user } = useAuth()
  const [id, setId] = useState(id0)
  const loaded = useFetch(id0 ? `/warehouse/products/${id0}/` : null)
  const suppliers = useFetch('/crm/counterparties/', { is_active: true })
  const [v, setV] = useState(null)
  const [prices, setPrices] = useState({})
  const [tab, setTab] = useState('prices')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const stocks = useFetch(id && tab === 'stock' ? '/warehouse/stock/' : null, { material: id })
  const moves = useFetch(id && tab === 'history' ? '/warehouse/moves/' : null, { material: id })
  const editable = id ? canEdit(user, 'products') : canCreate(user, 'products')

  const init = (p) => {
    setV({
      name: '', type: newType || 'goods', code: '', sku: '', barcode: '', unit: 'pcs', currency: baseCurrency(), purchase_price: '0',
      min_price: '0', min_price_currency: baseCurrency(), weight: '0', volume: '0', min_qty: '0', description: '', is_active: true,
      group: '', supplier: '', ...defaults, ...(p || {}),
    })
    setPrices(Object.fromEntries(Object.entries(p?.prices || {}).map(([k, x]) => [k, cleanNum(x)])))
    setDirty(false)
  }
  if (!v && (!id0 || loaded.data)) init(loaded.data)
  if (!v) return <DocPage onClose={onClose} toolbar={<button className="btn" onClick={onClose}>{t('Yopish')}</button>}><Loading error={loaded.error} /></DocPage>

  const set = (k) => (e) => { setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setDirty(true) }
  const save = async (close) => {
    setBusy(true)
    setError(null)
    const payload = { ...v, group: v.group || null, supplier: v.supplier || null,
      prices: Object.fromEntries(priceTypes.map((p) => [p.id, prices[p.id] === '' || prices[p.id] === undefined ? null : prices[p.id]])) }
    for (const k of ['stock_qty', 'avg_cost', 'unit_display', 'type_display', 'group_name', 'supplier_name', 'id', 'created_at', 'updated_at']) delete payload[k]
    try {
      const { data } = id ? await api.patch(`/warehouse/products/${id}/`, payload) : await api.post('/warehouse/products/', payload)
      setId(data.id)
      init(data)
      setChanged(true)
      toast(t('Saqlandi'))
      if (close) onSaved()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const close = async () => {
    if (dirty && !await confirmDialog(t("Saqlanmagan o'zgarishlar bor. Yopilsinmi?"))) return
    if (changed) onSaved()
    else onClose()
  }
  const remove = async () => {
    if (!await confirmDialog(t("O'chirilsinmi?") + `\n${v.name}`)) return
    try { await api.delete(`/warehouse/products/${id}/`); toast(t("O'chirildi")); onSaved() } catch (err) { setError(errorText(err)) }
  }
  const tree = flatTree(groups)
  const isService = v.type === 'service'

  return (
    <DocPage
      onClose={close}
      toolbar={<>
        <button className="btn primary" disabled={!editable || busy || !v.name.trim()} onClick={() => save(false)}><Icon name="save" size={16} /> {busy ? t('Saqlanmoqda…') : t('Saqlash')}</button>
        <button className="btn" disabled={!editable || busy || !v.name.trim()} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>
        <button className="btn" onClick={close}>{t('Yopish')}</button>
        <span className="grow" />
        {dirty && <span className="small muted">{t("Saqlanmagan o'zgarishlar")}</span>}
        {id && canDelete(user, 'products') && <button className="icon-act danger" title={t("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
      </>}
    >
      <label className="doc-name-label"><span className="req">*</span>{t(isService ? 'Xizmat nomi' : 'Tovar nomi')}</label>
      <input className="doc-title" value={v.name} onChange={set('name')} disabled={!editable} autoFocus={!id} />
      {error && <div className="error">{error}</div>}

      <div className="doc-layout">
        <div className="card side-form">
          <h2>{t("Umumiy ma'lumotlar")}</h2>
          <div className="row"><label>{t('Turi')}</label><select value={v.type} onChange={set('type')} disabled={!editable}>{PRODUCT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="row"><label>{t('Tavsif')}</label><textarea rows={2} value={v.description} onChange={set('description')} disabled={!editable} /></div>
          <div className="row"><label>{t('Guruh')}</label>
            <select value={v.group || ''} onChange={set('group')} disabled={!editable}>
              <option value="">—</option>
              {tree.map((g) => <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>)}
            </select>
          </div>
          <div className="row"><label>{t('Yetkazuvchi')}</label>
            <select value={v.supplier || ''} onChange={set('supplier')} disabled={!editable}>
              <option value="">—</option>
              {(suppliers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <hr />
          <div className="row"><label>{t('Artikul')}</label><input value={v.sku} onChange={set('sku')} disabled={!editable} /></div>
          <div className="row"><label>{t('Kod')}</label><input value={v.code} onChange={set('code')} disabled={!editable} placeholder={t('avto')} /></div>
          <div className="row"><label>{t('Shtrix-kod')}</label><input value={v.barcode} onChange={set('barcode')} disabled={!editable} /></div>
          <hr />
          <div className="row"><label>{t("O'lchov birligi")}</label><select value={v.unit} onChange={set('unit')} disabled={!editable}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {!isService && <>
            <div className="row"><label>{t("Og'irlik, kg")}</label><input type="number" step="any" min="0" value={cleanNum(v.weight)} onChange={set('weight')} disabled={!editable} /></div>
            <div className="row"><label>{t('Hajm, m³')}</label><input type="number" step="any" min="0" value={cleanNum(v.volume)} onChange={set('volume')} disabled={!editable} /></div>
            <div className="row"><label>{t('Minimal qoldiq')}</label><input type="number" step="any" min="0" value={cleanNum(v.min_qty)} onChange={set('min_qty')} disabled={!editable} /></div>
          </>}
          <div className="row"><label>{t('Faol')}</label><div><input type="checkbox" checked={v.is_active} onChange={set('is_active')} disabled={!editable} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} /></div></div>
        </div>

        <div>
          <div className="seg-tabs">
            {[['prices', t('Narxlar')], ...(isService ? [] : [['stock', t('Qoldiqlar')], ['history', t('Tarix')]])].map(([k, l]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} disabled={k !== 'prices' && !id} title={k !== 'prices' && !id ? t('Avval saqlang') : undefined}>{l}</button>
            ))}
          </div>
          {tab === 'prices' && (
            <div className="card price-card">
              <div className="price-row">
                <label>{t('Minimal narx')}</label>
                <input type="number" step="any" min="0" value={cleanNum(v.min_price)} onChange={set('min_price')} disabled={!editable} />
                <select value={v.min_price_currency} onChange={set('min_price_currency')} disabled={!editable}><CurrencyOptions withName value={v.min_price_currency} /></select>
              </div>
              <div className="price-row">
                <label>{t('Xarid narxi')}</label>
                <input type="number" step="any" min="0" value={cleanNum(v.purchase_price)} onChange={set('purchase_price')} disabled={!editable} />
                <select value={v.currency} onChange={set('currency')} disabled={!editable}><CurrencyOptions withName value={v.currency} /></select>
              </div>
              {v.avg_cost && <div className="hint" style={{ margin: '0 0 8px 170px' }}>{t("O'rtacha tannarx (ombor bo'yicha)")}: <b>{money(v.avg_cost, v.currency)}</b></div>}
              <h3 className="price-sub">{t('Sotuv narxlari')}</h3>
              {priceTypes.map((p) => (
                <div key={p.id} className="price-row">
                  <label>{p.name}{p.is_default && <span className="muted small"> · {t('asosiy')}</span>}</label>
                  <input type="number" step="any" min="0" value={prices[p.id] ?? ''} placeholder="0" disabled={!editable}
                    onChange={(e) => { setPrices({ ...prices, [p.id]: e.target.value }); setDirty(true) }} />
                  <span className="price-cur">{curLabel(p.currency)}</span>
                </div>
              ))}
              {!priceTypes.length && <p className="muted">{t("Narx turlari yo'q — \"Narx turlari\" tabida qo'shing")}</p>}
            </div>
          )}
          {tab === 'stock' && (
            <div className="table-wrap">
              {!stocks.data ? <Loading error={stocks.error} /> : (
                <table className="t">
                  <thead><tr><th>{t('Ombor')}</th><th className="num">{t('Qoldiq')}</th><th className="num">{t('Rezerv')}</th><th className="num">{t('Mavjud')}</th><th className="num">{t("O'rtacha narx")}</th><th className="num">{t('Qiymati')}</th></tr></thead>
                  <tbody>
                    {(stocks.data.results || []).map((s) => (
                      <tr key={s.id}><td>{s.warehouse_name}</td><td className="num">{qty(s.qty)}</td><td className="num">{qty(s.reserved)}</td><td className="num bold">{qty(s.available)}</td>
                        <td className="num">{money(s.avg_cost, s.currency)}</td><td className="num">{money(s.value, s.currency)}</td></tr>
                    ))}
                    {!(stocks.data.results || []).length && <tr><td colSpan={6} className="empty">{t('Omborda yo\'q')}</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {tab === 'history' && (
            <div className="table-wrap">
              {!moves.data ? <Loading error={moves.error} /> : (
                <table className="t compact">
                  <thead><tr><th>{t('Sana')}</th><th>{t('Turi')}</th><th>{t('Ombor')}</th><th className="num">{t('Miqdor')}</th><th className="num">{t('Narx')}</th><th>{t('Izoh')}</th></tr></thead>
                  <tbody>
                    {(moves.data.results || moves.data).map((m) => (
                      <tr key={m.id}><td>{date(m.date)}</td><td>{t(m.type_display)}</td><td>{m.warehouse_name}{m.to_warehouse_name && ` → ${m.to_warehouse_name}`}</td>
                        <td className={'num ' + (m.type === 'out' ? 'red' : 'green')}>{m.type === 'out' ? '−' : '+'}{qty(Math.abs(m.qty))}</td>
                        <td className="num">{money(m.price, m.currency)}</td><td className="small muted">{m.note}</td></tr>
                    ))}
                    {!(moves.data.results || moves.data).length && <tr><td colSpan={6} className="empty">{t("Harakatlar yo'q")}</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </DocPage>
  )
}

/* ------------------------------------------------------------ ro'yxat */
function Products({ user }) {
  const [params, setParams] = useSearchParams()
  const [stamp, setStamp] = useState(0)
  const [showFilter, setShowFilter] = useState(false)
  const [f, setF] = useState({ search: '', type: '', group: '', supplier: '', is_active: 'true' })
  const q = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, x]) => x !== '')), [f, stamp])
  const { data, error } = useFetch('/warehouse/products/', q)
  const groups = useFetch('/warehouse/groups/', { stamp })
  const pts = useFetch('/warehouse/price-types/')
  const suppliers = useFetch(showFilter ? '/crm/counterparties/' : null, { is_active: true })
  const [groupForm, setGroupForm] = useState(null)
  const priceTypes = pts.data || []
  const defPt = priceTypes.find((p) => p.is_default) || priceTypes[0]
  const rows = data || []
  const { rows: pageRows, pager } = usePager(rows, 50, JSON.stringify(q))
  const open = params.get('open')
  const setOpen = (val) => { const p = new URLSearchParams(params); if (val) p.set('open', val); else p.delete('open'); setParams(p) }
  const reload = () => setStamp((s) => s + 1)
  const removeGroup = async (g) => {
    if (!await confirmDialog(t("O'chirilsinmi?") + `\n${g.name}`)) return
    try { await api.delete(`/warehouse/groups/${g.id}/`); if (String(f.group) === String(g.id)) setF({ ...f, group: '' }); reload() } catch (e) { toast(errorText(e), true) }
  }
  const curGroup = (groups.data || []).find((g) => String(g.id) === String(f.group))

  return (
    <>
      <div className="page-head">
        <h1>{curGroup ? curGroup.name : t('Tovarlar va xizmatlar')}</h1>
        {canCreate(user, 'products') && <>
          <button className="btn primary" onClick={() => setOpen('new:goods')}><Icon name="plus" size={16} /> {t('Tovar')}</button>
          <button className="btn" onClick={() => setOpen('new:service')}><Icon name="plus" size={16} /> {t('Xizmat')}</button>
          <button className="btn" onClick={() => setGroupForm({ item: null })}><Icon name="plus" size={16} /> {t('Guruh')}</button>
        </>}
        <button className={'btn' + (showFilter ? ' active' : '')} onClick={() => setShowFilter((s) => !s)}><Icon name="filter" size={15} /> {t('Filtr')}</button>
        <span className="grow" />
        <div className="psearch" style={{ maxWidth: 340, minWidth: 220 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={t('Nomi, kod yoki artikul')} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
      </div>

      {showFilter && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{t('Turi')}
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="">{t('hammasi')}</option>
                {PRODUCT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>{t('Yetkazuvchi')}
              <select value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}>
                <option value="">{t('hammasi')}</option>
                {(suppliers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>{t('Holat')}
              <select value={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.value })}>
                <option value="true">{t('Faollar')}</option><option value="false">{t('Nofaollar')}</option><option value="">{t('Hammasi')}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      <div className="catalog">
        <GroupTree groups={groups.data || []} value={f.group} onPick={(g) => setF({ ...f, group: g })}
          editable={canEdit(user, 'products')} onEdit={(g) => setGroupForm({ item: g })} onDelete={removeGroup} />
        <div className="table-wrap">
          {!data ? <Loading error={error} /> : (
            <>
              <div className="table-toolbar"><b>{t('Hammasi')} {rows.length}</b></div>
              <table className="t">
                <thead>
                  <tr>
                    <th>{t('Nomi')}</th><th>{t('Kod')}</th><th>{t('Artikul')}</th><th>{t('Birlik')}</th><th>{t('Yetkazuvchi')}</th>
                    <th className="num">{t('Xarid narxi')}</th>
                    <th className="num">{t('Sotuv narxi')}{defPt && <span className="muted small"> · {defPt.name}</span>}</th>
                    <th className="num">{t('Qoldiq')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setOpen(String(p.id))}>
                      <td>
                        <span className="link-like">{p.name}</span>{!p.is_active && <span className="muted small"> {t('(nofaol)')}</span>}
                        {p.type !== 'goods' && <> <Badge kind={TYPE_BADGE[p.type]}>{t(p.type_display)}</Badge></>}
                      </td>
                      <td className="muted">{p.code}</td>
                      <td className="muted">{p.sku}</td>
                      <td>{t(p.unit_display)}</td>
                      <td>{p.supplier_name || ''}</td>
                      <td className="num">{money(p.purchase_price, p.currency)}</td>
                      <td className="num bold">{defPt && p.prices[defPt.id] ? money(p.prices[defPt.id], defPt.currency) : <span className="muted">—</span>}</td>
                      <td className="num">{p.stock_qty === null ? <span className="muted">—</span> : qty(p.stock_qty)}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={8} className="empty">{t('Tovarlar topilmadi')}</td></tr>}
                </tbody>
              </table>
              {pager}
            </>
          )}
        </div>
      </div>

      {open && (
        <ProductPage
          key={open}
          id={open.startsWith('new') ? null : open}
          newType={open.startsWith('new:') ? open.slice(4) : null}
          defaults={f.group && f.group !== 'none' ? { group: Number(f.group) } : {}}
          groups={groups.data || []} priceTypes={priceTypes}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); reload() }}
        />
      )}
      {groupForm && (
        <GroupForm item={groupForm.item} groups={flatTree(groups.data || [])} parent={f.group && f.group !== 'none' ? f.group : ''}
          onClose={() => setGroupForm(null)} onSaved={() => { setGroupForm(null); reload(); toast(t('Saqlandi')) }} />
      )}
    </>
  )
}

function PriceTypes({ user }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/warehouse/price-types/', { stamp })
  const [form, setForm] = useState(null)
  const remove = async (r) => {
    if (!await confirmDialog(t("O'chirilsinmi?") + `\n${r.name}`)) return
    try { await api.delete(`/warehouse/price-types/${r.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="page-head">
        <h1>{t('Narx turlari')}</h1>
        {canCreate(user, 'products') && <button className="btn primary" onClick={() => setForm({ item: null })}><Icon name="plus" size={16} /> {t('Narx turi')}</button>}
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap" style={{ maxWidth: 760 }}>
          <table className="t">
            <thead><tr><th>{t('Nomi')}</th><th>{t('Valyuta')}</th><th /><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="bold">{r.name}</td><td>{curLabel(r.currency)}</td>
                  <td>{r.is_default && <Badge kind="ok">{t('asosiy')}</Badge>}</td>
                  <td className="num">
                    {canEdit(user, 'products') && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: r })} />}
                    {canDelete(user, 'products') && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(r)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{t("Narx turi — Chakana, Ulgurji, Diler… Mijozga narx turi biriktirilsa, sotuvda shu narx qo'yiladi.")}</p>
      {form && <EntityForm dialog title={form.item ? form.item.name : t('Yangi narx turi')} url="/warehouse/price-types/" item={form.item}
        fields={[
          { name: 'name', label: t("Nomi (Chakana, Ulgurji, Diler…)"), required: true, full: true },
          { name: 'currency', label: t('Valyuta'), type: 'select', options: currencyOptions(), noEmpty: true },
          { name: 'is_default', label: t('Asosiy (sotuvda standart)'), type: 'checkbox' },
        ]}
        defaults={{ currency: baseCurrency() }} onClose={() => setForm(null)}
        onSaved={() => { setForm(null); setStamp((s) => s + 1); toast(t('Saqlandi')) }} />}
    </>
  )
}

export default function ProductsPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('products')
  return (
    <>
      <div className="tabs section-tabs">
        {[['products', t('Tovarlar va xizmatlar')], ['prices', t('Narx turlari')]].map(([k, l]) => (
          <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <Fragment key={tab}>
        {tab === 'products' && <Products user={user} />}
        {tab === 'prices' && <PriceTypes user={user} />}
      </Fragment>
    </>
  )
}

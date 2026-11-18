import { useMemo, useState } from 'react'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import EntityForm from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, Stat, toast, useFetch } from '../../components/ui'
import { money, qty } from '../../format'
import { t } from '../../i18n'
import { IconBtn } from '../../components/Icon'
import { curLabel } from '../../currency'

export const PRODUCT_TYPES = [
  ['raw', t("Xomashyo / material")],
  ['product', t("Tayyor mahsulot")],
  ['goods', t("Tovar (qayta sotish)")],
  ['service', t("Xizmat")],
]
const TYPE_BADGE = { raw: 'neutral', product: 'confirmed', goods: 'in_production', service: 'ready' }
const UNITS = [['pcs', t("dona")], ['m', 'm'], ['m2', 'm²'], ['kg', t("kg")], ['set', t("to'plam")]]
const CUR = [['UZS', t("so'm")], ['USD', 'USD']]

function ProductForm({ item, groups, priceTypes, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    name: '', type: 'goods', sku: '', barcode: '', unit: 'pcs', currency: 'UZS', purchase_price: '0',
    min_qty: '0', description: '', is_active: true, ...(item || {}), group: item?.group ?? '',
  }))
  const [prices, setPrices] = useState(() => ({ ...(item?.prices || {}) }))
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const payload = { ...v, group: v.group || null, prices: Object.fromEntries(priceTypes.map((p) => [p.id, prices[p.id] === '' || prices[p.id] === undefined ? null : prices[p.id]])) }
    for (const k of ['stock_qty', 'avg_cost', 'unit_display', 'type_display', 'group_name', 'id']) delete payload[k]
    try {
      item ? await api.patch(`/warehouse/products/${item.id}/`, payload) : await api.post('/warehouse/products/', payload)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }

  return (
    <Modal title={item ? item.name : 'Yangi tovar'} onClose={onClose} wide>
      {error && <div className="error">{error}</div>}
      <form className="form three" onSubmit={submit}>
        <div className="full section-title" style={{ marginTop: 0 }}>{t("Asosiy")}</div>
        <Field label={t("Nomi")} full><input value={v.name} onChange={set('name')} required autoFocus /></Field>
        <Field label={t("Turi")}>
          <select value={v.type} onChange={set('type')}>{PRODUCT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label={t("Guruh")}>
          <select value={v.group ?? ''} onChange={set('group')}>
            <option value="">—</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label={t("O'lchov birligi")}>
          <select value={v.unit} onChange={set('unit')}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label={t("Artikul")}><input value={v.sku} onChange={set('sku')} /></Field>
        <Field label={t("Shtrix-kod")}><input value={v.barcode} onChange={set('barcode')} /></Field>
        <div><label className="check" style={{ marginTop: 26 }}><input type="checkbox" checked={v.is_active} onChange={set('is_active')} /> {t("Faol")}</label></div>

        <div className="full section-title">{t("Tannarx va ombor")}</div>
        <Field label={t("Tannarx valyutasi")}>
          <select value={v.currency} onChange={set('currency')} disabled={!!item}>{CUR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label={t("Xarid narxi (oxirgi)")}><input type="number" step="any" min="0" value={v.purchase_price} onChange={set('purchase_price')} /></Field>
        <Field label={t("Minimal qoldiq")}><input type="number" step="any" min="0" value={v.min_qty} onChange={set('min_qty')} disabled={v.type === 'service'} /></Field>

        <div className="full section-title">{t("Sotuv narxlari")}</div>
        {priceTypes.map((p) => (
          <Field key={p.id} label={`${p.name} (${curLabel(p.currency)})${p.is_default ? ' · asosiy' : ''}`}>
            <input type="number" step="any" min="0" value={prices[p.id] ?? ''} placeholder={t("narx belgilanmagan")}
              onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} />
          </Field>
        ))}
        {!priceTypes.length && <p className="hint full">{t("Avval \"Narx turlari\" tabida narx turini qo'shing.")}</p>}
        <Field label={t("Tavsif")} full><textarea rows={2} value={v.description} onChange={set('description')} /></Field>
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

function Products({ user }) {
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ search: '', type: '', group: '', is_active: 'true' })
  const params = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== '')), [f, stamp])
  const { data, error } = useFetch('/warehouse/products/', params)
  const groups = useFetch('/warehouse/groups/')
  const pts = useFetch('/warehouse/price-types/')
  const [form, setForm] = useState(null)
  const priceTypes = pts.data || []
  const rows = data || []

  const remove = async (p) => {
    if (!window.confirm(`"${p.name}" o'chirilsinmi?`)) return
    try { await api.delete(`/warehouse/products/${p.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }

  return (
    <>
      <div className="stats">
        <Stat label={t("Tovarlar soni")} value={rows.length} />
        <Stat label={t("Tayyor mahsulot / tovar")} value={rows.filter((r) => ['product', 'goods'].includes(r.type)).length} />
        <Stat label={t("Narxi belgilanmagan")} value={rows.filter((r) => r.type !== 'raw' && !Object.keys(r.prices).length).length}
          valueClass={rows.some((r) => r.type !== 'raw' && !Object.keys(r.prices).length) ? 'red' : ''} />
      </div>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          {canCreate(user, 'products') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Tovar")}</button>}
          <input placeholder={t("Nomi, artikul, shtrix-kod…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} style={{ width: 230 }} />
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">{t("Turi: hammasi")}</option>
            {PRODUCT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>
            <option value="">{t("Guruh: hammasi")}</option>
            {(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.value })}>
            <option value="true">{t("Faollar")}</option><option value="false">{t("Nofaollar")}</option><option value="">{t("Hammasi")}</option>
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead>
              <tr>
                <th>{t("Nomi")}</th><th>{t("Turi")}</th><th>{t("Guruh")}</th><th>{t("Birlik")}</th><th className="num">{t("Qoldiq")}</th><th className="num">{t("Tannarx")}</th>
                {priceTypes.map((p) => <th key={p.id} className="num">{p.name}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={canEdit(user, 'products') ? 'clickable' : ''} onClick={() => canEdit(user, 'products') && setForm({ item: p })}>
                  <td><div className="bold">{p.name}{!p.is_active && <span className="muted small"> {t("(nofaol)")}</span>}</div>{p.sku && <div className="small muted">{p.sku}</div>}</td>
                  <td><Badge kind={TYPE_BADGE[p.type]}>{p.type_display}</Badge></td>
                  <td>{p.group_name || '—'}</td>
                  <td>{p.unit_display}</td>
                  <td className="num">{p.stock_qty === null ? <span className="muted">—</span> : qty(p.stock_qty)}</td>
                  <td className="num">{money(p.avg_cost ?? p.purchase_price, p.currency)}</td>
                  {priceTypes.map((pt) => (
                    <td key={pt.id} className="num bold">{p.prices[pt.id] ? money(p.prices[pt.id], pt.currency) : <span className="muted">—</span>}</td>
                  ))}
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    {canDelete(user, 'products') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(p)} />}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7 + priceTypes.length} className="empty">{t("Tovarlar topilmadi")}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="legend"><span>{t("Tannarx — ombordagi o'rtacha tortilgan narx (bo'lmasa oxirgi xarid narxi).")}</span><span>{t("Xizmat omborda hisobga olinmaydi.")}</span></div>
      {form && (
        <ProductForm item={form.item} groups={groups.data || []} priceTypes={priceTypes}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Tovar saqlandi') }} />
      )}
    </>
  )
}

function SimpleList({ url, title, fields, columns, user }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch(url, { stamp })
  const [form, setForm] = useState(null)
  const remove = async (r) => {
    if (!window.confirm(`"${r.name}" o'chirilsinmi?`)) return
    try { await api.delete(`${url}${r.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!data) return <Loading error={error} />
  return (
    <div className="table-wrap" style={{ maxWidth: 720 }}>
      <div className="table-toolbar">
        <b>{title}</b><span style={{ flex: 1 }} />
        {canCreate(user, 'products') && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Qo'shish")}</button>}
      </div>
      <table className="t">
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}
              <td className="num">
                {canEdit(user, 'products') && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: r })} />}{' '}
                {canDelete(user, 'products') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(r)} />}
              </td>
            </tr>
          ))}
          {!data.length && <tr><td className="empty">{t("Bo'sh")}</td></tr>}
        </tbody>
      </table>
      {form && <EntityForm title={form.item ? form.item.name : title} url={url} item={form.item} fields={fields}
        defaults={{ currency: 'UZS' }} onClose={() => setForm(null)}
        onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />}
    </div>
  )
}

export default function ProductsPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('products')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Tovarlar")}</h1>
          <div className="page-sub">{t("Nomenklatura: xomashyo, tayyor mahsulot, tovar va xizmatlar; narx turlari bo'yicha narxlar")}</div>
        </div>
      </div>
      <div className="tabs">
        {[['products', t("Tovarlar")], ['prices', t("Narx turlari")], ['groups', t("Guruhlar")]].map(([k, l]) => (
          <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'products' && <Products user={user} />}
      {tab === 'prices' && (
        <SimpleList user={user} url="/warehouse/price-types/" title={t("Narx turlari")}
          fields={[
            { name: 'name', label: t("Nomi (Chakana, Ulgurji, Diler…)"), required: true, full: true },
            { name: 'currency', label: t("Valyuta"), type: 'select', options: CUR, noEmpty: true },
            { name: 'is_default', label: t("Asosiy (sotuvda standart)"), type: 'checkbox' },
          ]}
          columns={[{ key: 'name', render: (r) => <b>{r.name}</b> }, { key: 'currency', render: (r) => curLabel(r.currency) },
            { key: 'is_default', render: (r) => (r.is_default ? <Badge kind="ok">{t("asosiy")}</Badge> : '') }]} />
      )}
      {tab === 'groups' && (
        <SimpleList user={user} url="/warehouse/groups/" title={t("Tovar guruhlari")}
          fields={[{ name: 'name', label: t("Nomi"), required: true, full: true }]} columns={[{ key: 'name' }]} />
      )}
    </>
  )
}

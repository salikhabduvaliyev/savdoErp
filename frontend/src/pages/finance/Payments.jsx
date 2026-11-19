// Pul (MoySklad "Платежи"): kirim/chiqim orderlari, kiruvchi/chiquvchi to'lovlar, hisoblar orasida ko'chirish
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { BulkMenu, SearchSelect, usePager } from '../../components/Controls'
import { cleanNum, DocField, DocPage, DocTitle } from '../../components/DocEditor'
import Icon from '../../components/Icon'
import { Badge, Loading, Modal, MoneyBag, Stat, toast, useFetch } from '../../components/ui'
import { curLabel } from '../../currency'
import { date, money, todayISO } from '../../format'
import { t } from '../../i18n'

/* Hujjat turlari: yo'nalish + hisob turi (kassa/bank) */
const DOC = {
  'in:cash': { title: 'Kirim orderi', icon: 'plus' },
  'in:bank': { title: "Kiruvchi to'lov", icon: 'plus' },
  'out:cash': { title: 'Chiqim orderi', icon: 'plus' },
  'out:bank': { title: "Chiquvchi to'lov", icon: 'plus' },
}
// Chiqim moddasi: maxsus turlar + xarajat moddalari (MoySklad "Статья расходов")
const SPECIAL_OUT = [['__supplier', "Tovar xaridi (yetkazuvchiga to'lov)"], ['__salary', 'Ish haqi']]

/* ------------------------------------------------------------ to'lov hujjati */
export function PaymentDoc({ direction, accountKind, item, presetOrder, presetSale, onClose, onSaved }) {
  const { user } = useAuth()
  const accounts = useFetch('/finance/accounts/')
  const cps = useFetch('/crm/counterparties/', { is_active: true })
  const cats = useFetch('/finance/categories/')
  const dir = item?.direction || direction
  const [v, setV] = useState(() => item ? {
    date: item.date, account: item.account, amount: cleanNum(item.amount), description: item.description || '',
    counterparty: item.client || item.supplier || '', category: item.kind === 'supplier_payment' ? '__supplier' : item.kind === 'salary' ? '__salary' : (item.category || ''),
    order: item.order || '', sale: item.sale || '', stock_doc: item.stock_doc || '', order_amount: cleanNum(item.order_amount), other: item.kind === 'other_income',
  } : { date: todayISO(), account: '', amount: presetSale ? String(Number(presetSale.debt) || '') : '', description: '', counterparty: presetSale?.client || presetOrder?.client || '', category: '', order: presetOrder?.id || '', sale: presetSale?.id || '', stock_doc: '', order_amount: '', other: false })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const docs = useFetch(v.counterparty ? '/finance/transactions/open_documents/' : null, { counterparty: v.counterparty, direction: dir })
  const accs = (accounts.data || []).filter((a) => a.is_active)
  const kindOf = item?.account_kind || accountKind || 'cash'
  const acc = accs.find((a) => String(a.id) === String(v.account)) || null
  // asosiy valyuta (so'm) hisoblari birinchi
  const accOpts = accs.filter((a) => !accountKind || item || a.kind === accountKind).sort((a, b) => (a.currency === 'UZS' ? 0 : 1) - (b.currency === 'UZS' ? 0 : 1))
  if (!v.account && accOpts.length && !item) setV((s) => ({ ...s, account: accOpts[0].id }))
  const docKey = `${dir}:${acc?.kind || kindOf}`
  const title = DOC[docKey]?.title || "To'lov"
  const linked = v.order ? { type: 'order', id: v.order } : v.sale ? { type: 'sale', id: v.sale } : v.stock_doc ? { type: 'supply', id: v.stock_doc } : null
  const linkedDoc = (docs.data || []).find((d) => linked && d.type === linked.type && String(d.id) === String(linked.id))
  const editable = item ? canEdit(user, 'finance') : canCreate(user, 'finance')
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))

  const kind = dir === 'in'
    ? (v.other || (!v.counterparty && !v.order && !v.sale) ? 'other_income' : 'client_payment')
    : v.category === '__supplier' ? 'supplier_payment' : v.category === '__salary' ? 'salary' : 'expense'

  const save = async (close) => {
    setBusy(true)
    setError(null)
    const payload = {
      date: v.date, account: v.account, amount: v.amount, description: v.description, kind,
      client: dir === 'in' ? v.counterparty || null : null,
      supplier: dir === 'out' ? v.counterparty || null : null,
      category: kind === 'expense' || kind === 'salary' ? (v.category?.startsWith('__') ? null : v.category || null) : null,
      order: v.order || null, sale: v.sale || null, stock_doc: v.stock_doc || null,
      ...(linkedDoc && acc && linkedDoc.currency !== acc.currency && v.order_amount ? { order_amount: v.order_amount } : {}),
    }
    try {
      item ? await api.patch(`/finance/transactions/${item.id}/`, payload) : await api.post('/finance/transactions/', payload)
      toast(t('Saqlandi'))
      onSaved(close)
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(t("O'chirilsinmi?"))) return
    try { await api.delete(`/finance/transactions/${item.id}/`); toast(t("O'chirildi")); onSaved(true) } catch (err) { setError(errorText(err)) }
  }
  const pick = (d) => {
    const reset = { order: '', sale: '', stock_doc: '' }
    if (linked && linked.type === d.type && String(linked.id) === String(d.id)) { setV((s) => ({ ...s, ...reset })); return }
    setV((s) => ({ ...s, ...reset, [d.type === 'supply' ? 'stock_doc' : d.type]: d.id, amount: s.amount || (acc && acc.currency === d.currency ? cleanNum(d.debt) : s.amount),
      category: d.type === 'supply' ? '__supplier' : s.category }))
  }
  const catOpts = [...SPECIAL_OUT.map(([k, l]) => ({ value: k, label: t(l) })), ...(cats.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.affects_profit ? '' : t("foydaga ta'sir qilmaydi") }))]
  const ok = editable && !busy && v.account && Number(v.amount) > 0 && (dir === 'in' || v.category)

  return (
    <DocPage onClose={onClose} toolbar={<>
      <button className="btn primary" disabled={!ok} onClick={() => save(false)}><Icon name="save" size={16} /> {t('Saqlash')}</button>
      <button className="btn" disabled={!ok} onClick={() => save(true)}>{t('Saqlash va yopish')}</button>
      <button className="btn" onClick={onClose}>{t('Yopish')}</button>
      <span className="grow" />
      {item && canDelete(user, 'finance') && <button className="icon-act danger" title={t("O'chirish")} onClick={remove}><Icon name="delete" size={18} /></button>}
    </>}>
      <DocTitle label={title} number={item?.number} date={v.date} onDate={editable ? (d) => set('date', d) : null}>
        <Badge kind={dir === 'in' ? 'ok' : 'cancelled'}>{dir === 'in' ? t('Kirim') : t('Chiqim')}</Badge>
      </DocTitle>
      {error && <div className="error">{error}</div>}
      <div className="doc-grid">
        <div>
          <DocField label={acc?.kind === 'bank' ? 'Bank hisobi' : 'Kassa'} required>
            <SearchSelect value={v.account} onChange={(id) => set('account', id)} disabled={!editable}
              options={accOpts.map((a) => ({ value: a.id, label: a.name, sub: `${money(a.balance, a.currency)}` }))} />
          </DocField>
          <DocField label="Kontragent" required={dir === 'in' && !v.other}>
            <SearchSelect value={v.counterparty} onChange={(id) => setV((s) => ({ ...s, counterparty: id, order: '', sale: '', stock_doc: '' }))} disabled={!editable}
              empty={dir === 'in' ? undefined : '—'} placeholder={t('Kontragentni tanlang…')}
              options={(cps.data || []).map((c) => ({ value: c.id, label: c.name, sub: c.phone }))}
              onCreate={async (name) => {
                const n = name || window.prompt(t('Yangi kontragent nomi'))
                if (!n) return
                try { const { data } = await api.post('/crm/counterparties/', { name: n }); cps.reload(); set('counterparty', data.id) } catch (e) { setError(errorText(e)) }
              }} createLabel={t('Yangi kontragent')} />
          </DocField>
        </div>
        <div>
          <DocField label="Summa" required>
            <div className="inline-pick"><input type="number" step="any" min="0" value={v.amount} onChange={(e) => set('amount', e.target.value)} disabled={!editable} className="big-num" />
              <span className="muted">{acc ? curLabel(acc.currency) : ''}</span></div>
          </DocField>
          {dir === 'out' && (
            <DocField label="Xarajat moddasi" required>
              <SearchSelect value={v.category} onChange={(id) => set('category', id)} disabled={!editable} options={catOpts} placeholder={t('Moddani tanlang…')} />
            </DocField>
          )}
          {dir === 'in' && (
            <DocField label="Turi">
              <label className="check"><input type="checkbox" checked={v.other} onChange={(e) => set('other', e.target.checked)} disabled={!editable} /> {t("Boshqa kirim (mijoz to'lovi emas)")}</label>
            </DocField>
          )}
        </div>
        <div>
          <DocField label="Asos / izoh" wide><textarea rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} disabled={!editable} /></DocField>
        </div>
      </div>

      <div className="doc-tabs"><span className="active">{t("To'lanayotgan hujjat")}</span></div>
      <div className="positions">
        {!v.counterparty ? <div className="empty">{t("Kontragentni tanlang — uning to'lanmagan hujjatlari chiqadi")}</div> : !docs.data ? <Loading error={docs.error} /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th style={{ width: 40 }} /><th>{t('Hujjat')}</th><th>{t('Sana')}</th><th className="num">{t('Summa')}</th><th className="num">{t("To'lanmagan")}</th></tr></thead>
              <tbody>
                {docs.data.map((d) => {
                  const on = linked && linked.type === d.type && String(linked.id) === String(d.id)
                  return (
                    <tr key={d.type + d.id} className={'clickable' + (on ? ' picked' : '')} onClick={() => editable && pick(d)}>
                      <td><input type="radio" readOnly checked={!!on} /></td>
                      <td className="bold">{t(d.label.split(' №')[0])} №{d.label.split('№')[1]}</td>
                      <td>{date(d.date)}</td>
                      <td className="num">{money(d.amount, d.currency)}</td>
                      <td className="num red bold">{money(d.debt, d.currency)}</td>
                    </tr>
                  )
                })}
                {!docs.data.length && <tr><td colSpan={5} className="empty">{t("To'lanmagan hujjatlar yo'q — to'lov avans sifatida yoziladi")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {linkedDoc && acc && linkedDoc.currency !== acc.currency && (
          <div className="positions-add">
            <span>{t('Hujjat valyutasida ({c})', { c: curLabel(linkedDoc.currency) })}:</span>
            <input type="number" step="any" style={{ width: 160 }} value={v.order_amount} placeholder={t('bo\'sh — kurs bo\'yicha')} onChange={(e) => set('order_amount', e.target.value)} />
          </div>
        )}
        {item && (item.order || item.sale) && !linkedDoc && (
          <div className="positions-add small">{t("Bog'langan")}: {item.order ? <Link to={`/orders/${item.order}`}>{t('Buyurtma')} №{item.order_number}</Link> : `${t('Sotuv')} №${item.sale_number}`}</div>
        )}
      </div>
    </DocPage>
  )
}

/* ------------------------------------------------------------ ko'chirish (Перемещение) */
function TransferForm({ onClose, onSaved }) {
  const accounts = useFetch('/finance/accounts/')
  const [v, setV] = useState({ from_account: '', to_account: '', amount: '', to_amount: '', date: todayISO(), description: '' })
  const [error, setError] = useState(null)
  const accs = (accounts.data || []).filter((a) => a.is_active)
  const src = accs.find((a) => String(a.id) === String(v.from_account))
  const dst = accs.find((a) => String(a.id) === String(v.to_account))
  const opts = accs.map((a) => ({ value: a.id, label: a.name, sub: money(a.balance, a.currency) }))
  const submit = async () => {
    try { await api.post('/finance/transactions/transfer/', { ...v, to_amount: v.to_amount || undefined }); toast(t("Ko'chirildi")); onSaved() } catch (e) { setError(errorText(e)) }
  }
  return (
    <Modal title="Hisoblar orasida ko'chirish" onClose={onClose} dialog>
      {error && <div className="error">{error}</div>}
      <div className="form">
        <label className="field"><span>{t('Qaysi hisobdan')}</span><SearchSelect value={v.from_account} onChange={(id) => setV({ ...v, from_account: id })} options={opts} /></label>
        <label className="field"><span>{t('Qaysi hisobga')}</span><SearchSelect value={v.to_account} onChange={(id) => setV({ ...v, to_account: id })} options={opts.filter((o) => String(o.value) !== String(v.from_account))} /></label>
        <label className="field"><span>{t('Summa')}{src ? ` (${curLabel(src.currency)})` : ''}</span><input type="number" step="any" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></label>
        {src && dst && src.currency !== dst.currency && (
          <label className="field"><span>{t('Kelgan summa')} ({curLabel(dst.currency)})</span><input type="number" step="any" placeholder={t("bo'sh — kurs bo'yicha")} value={v.to_amount} onChange={(e) => setV({ ...v, to_amount: e.target.value })} /></label>
        )}
        <label className="field"><span>{t('Sana')}</span><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></label>
        <label className="field full"><span>{t('Izoh')}</span><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        <div className="full form-actions">
          <button className="btn ghost" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary" disabled={!v.from_account || !v.to_account || !(Number(v.amount) > 0)} onClick={submit}><Icon name="check" size={16} /> {t("Ko'chirish")}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ ro'yxat */
function DropBtn({ label, primary, items }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bulk" onMouseLeave={() => setOpen(false)}>
      <button className={'btn' + (primary ? ' primary' : '')} onClick={() => setOpen((o) => !o)}><Icon name="plus" size={16} /> {label} <Icon name="chevron-down" size={14} /></button>
      {open && <div className="bulk-menu">{items.map(([l, fn]) => <button key={l} className="bulk-item" onClick={() => { setOpen(false); fn() }}>{l}</button>)}</div>}
    </div>
  )
}

export default function Payments({ onChanged }) {
  const { user } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [showFilter, setShowFilter] = useState(false)
  const empty = { date_from: '', date_to: '', account: '', direction: '', counterparty: '', search: '', category: '' }
  const [f, setF] = useState(empty)
  const q = useMemo(() => Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, x]) => x !== '')), [f, stamp])
  const { data, error } = useFetch('/finance/transactions/', q)
  const accounts = useFetch('/finance/accounts/', { stamp })
  const cps = useFetch(showFilter ? '/crm/counterparties/' : null, { is_active: true })
  const cats = useFetch(showFilter ? '/finance/categories/' : null)
  const [doc, setDoc] = useState(null)
  const [transfer, setTransfer] = useState(false)
  const [selected, setSelected] = useState([])
  const { rows, pager } = usePager(data?.results, 50, JSON.stringify(q))
  const reload = () => { setStamp((s) => s + 1); onChanged?.() }
  const removeSel = async () => {
    if (!window.confirm(t("Tanlangan to'lovlar o'chirilsinmi?"))) return
    let n = 0
    for (const id of selected) { try { await api.delete(`/finance/transactions/${id}/`); n++ } catch (e) { toast(errorText(e), true) } }
    toast(t('Bajarildi: {n} ta', { n }))
    setSelected([])
    reload()
  }
  const can = canCreate(user, 'finance')

  return (
    <>
      <div className="page-head">
        {can && <DropBtn primary label={t('Kirim')} items={[[t('Kirim orderi (kassa)'), () => setDoc({ direction: 'in', kind: 'cash' })], [t("Kiruvchi to'lov (bank)"), () => setDoc({ direction: 'in', kind: 'bank' })]]} />}
        {can && <DropBtn label={t('Chiqim')} items={[[t('Chiqim orderi (kassa)'), () => setDoc({ direction: 'out', kind: 'cash' })], [t("Chiquvchi to'lov (bank)"), () => setDoc({ direction: 'out', kind: 'bank' })]]} />}
        {can && <button className="btn" onClick={() => setTransfer(true)}><Icon name="refresh" size={16} /> {t("Ko'chirish")}</button>}
        <button className={'btn' + (showFilter ? ' active' : '')} onClick={() => setShowFilter((x) => !x)}><Icon name="filter" size={15} /> {t('Filtr')}</button>
        <span className="grow" />
        <div className="psearch" style={{ maxWidth: 320, minWidth: 220 }}>
          <Icon name="search" size={16} className="psearch-ic" />
          <input placeholder={t('Izoh yoki kontragent')} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
      </div>
      {accounts.data && (
        <div className="stats">
          {accounts.data.filter((a) => a.is_active).map((a) => <Stat key={a.id} label={a.name} value={money(a.balance, a.currency)} valueClass={Number(a.balance) < 0 ? 'red' : ''} />)}
        </div>
      )}
      {showFilter && (
        <div className="filter-panel card">
          <div className="filter-grid">
            <label>{t('Davr')}<div className="inline-pick"><input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />—<input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></div></label>
            <label>{t('Yo\'nalish')}
              <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="">{t('hammasi')}</option><option value="in">{t('Kirim')}</option><option value="out">{t('Chiqim')}</option></select>
            </label>
            <label>{t('Hisob')}
              <select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="">{t('hammasi')}</option>{(accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label>{t('Kontragent')}<SearchSelect value={f.counterparty} onChange={(id) => setF({ ...f, counterparty: id })} empty={t('hammasi')} options={(cps.data || []).map((c) => ({ value: c.id, label: c.name }))} /></label>
            <label>{t('Xarajat moddasi')}<SearchSelect value={f.category} onChange={(id) => setF({ ...f, category: id })} empty={t('hammasi')} options={(cats.data || []).map((c) => ({ value: c.id, label: c.name }))} /></label>
          </div>
          <div className="filter-actions"><span className="grow" /><button className="btn small" onClick={() => setF(empty)}>{t('Tozalash')}</button></div>
        </div>
      )}
      {!data ? <Loading error={error} /> : (
        <div className="table-wrap">
          <div className="table-toolbar">
            <b>{t('Hammasi')} {data.results.length}</b>
            {canDelete(user, 'finance') && <BulkMenu count={selected.length} items={[{ label: t("O'chirish"), danger: true, onClick: removeSel }]} />}
          </div>
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 30 }}><input type="checkbox" checked={!!data.results.length && selected.length === data.results.length} onChange={(e) => setSelected(e.target.checked ? data.results.map((x) => x.id) : [])} /></th>
                <th>{t('Hujjat turi')}</th><th>№</th><th>{t('Sana')}</th><th>{t('Kontragent')}</th><th>{t('Hisob')}</th>
                <th className="num">{t('Kirim')}</th><th className="num">{t('Chiqim')}</th><th>{t('Valyuta')}</th><th>{t('Asos')}</th><th>{t("To'lov maqsadi")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => !x.pair && setDoc({ item: x })}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(x.id)} onChange={() => setSelected((s) => (s.includes(x.id) ? s.filter((y) => y !== x.id) : [...s, x.id]))} /></td>
                  <td>{t(x.doc_type)}</td>
                  <td><span className="link-like">{String(x.number || '').padStart(5, '0')}</span></td>
                  <td>{date(x.date)}</td>
                  <td>{x.counterparty || (x.pair_account ? `→ ${x.pair_account}` : '—')}</td>
                  <td className="small">{x.account_name}</td>
                  <td className="num green">{x.direction === 'in' ? money(x.amount, x.currency) : ''}</td>
                  <td className="num red">{x.direction === 'out' ? money(x.amount, x.currency) : ''}</td>
                  <td>{curLabel(x.currency)}</td>
                  <td className="small" onClick={(e) => e.stopPropagation()}>
                    {x.order ? <Link to={`/orders/${x.order}`}>{t('Buyurtma')} №{x.order_number}</Link>
                      : x.sale ? <Link to={`/sales?open=${x.sale}`}>{t('Sotuv')} №{x.sale_number}</Link>
                        : x.stock_doc ? <Link to={`/purchases/supplies?open=${x.stock_doc}`}>{t('Qabul qilish')} №{x.stock_doc_number}</Link> : <span className="muted">—</span>}
                  </td>
                  <td className="small muted ellipsis">{[x.category_name || (x.kind !== 'client_payment' && x.kind !== 'expense' ? t(x.kind_display) : ''), x.description].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
              {!data.results.length && <tr><td colSpan={11} className="empty">{t("To'lovlar yo'q")}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>{t('Jami (valyuta bo\'yicha)')}</td><td className="num green"><MoneyBag bag={data.in} /></td><td className="num red"><MoneyBag bag={data.out} /></td><td colSpan={3} /></tr>
            </tfoot>
          </table>
          {pager}
        </div>
      )}
      {doc && <PaymentDoc key={doc.item?.id || doc.direction + doc.kind} direction={doc.direction} accountKind={doc.kind} item={doc.item}
        onClose={() => setDoc(null)} onSaved={(close) => { reload(); if (close || !doc.item) setDoc(null) }} />}
      {transfer && <TransferForm onClose={() => setTransfer(false)} onSaved={() => { setTransfer(false); reload() }} />}
    </>
  )
}

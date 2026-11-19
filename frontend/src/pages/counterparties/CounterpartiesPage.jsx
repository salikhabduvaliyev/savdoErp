import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorText } from '../../api'
import { canCreate, canDelete, canEdit, useAuth } from '../../auth'
import { CustomFieldFilter, CustomFieldsManager, formatExtra, useCustomFields } from '../../components/CustomFields'
import EntityForm from '../../components/EntityForm'
import PageSettings, { usePageSettings } from '../../components/PageSettings'
import { Loading, Modal, Stat, toast, useFetch } from '../../components/ui'
import { money } from '../../format'
import { t } from '../../i18n'
import { IconBtn } from '../../components/Icon'
import { usePager } from '../../components/Controls'

const COLUMNS = [
  { key: 'name', label: t("Nomi"), fixed: true },
  { key: 'status', label: t("Holat") },
  { key: 'groups', label: t("Guruhlar") },
  { key: 'phone', label: t("Telefon") },
  { key: 'email', label: t("Email"), hidden: true },
  { key: 'contact', label: t("Mas'ul shaxs"), hidden: true },
  { key: 'inn', label: t("STIR") },
  { key: 'address', label: t("Manzil"), hidden: true },
  { key: 'owner', label: t("Mas'ul xodim"), hidden: true },
  { key: 'orders', label: t("Buyurtmalar") },
  { key: 'receivable', label: t("Bizga qarzi") },
  { key: 'payable', label: t("Bizning qarzimiz") },
]
const SECTIONS = [{ key: 'stats', label: t("Ko'rsatkichlar kartochkalari") }, { key: 'filters', label: t("Filtrlar paneli") }]

function GroupsManager({ onClose, onChanged, editable }) {
  const [stamp, setStamp] = useState(0)
  const groups = useFetch('/crm/groups/', { stamp })
  const statuses = useFetch('/crm/statuses/', { stamp })
  const [form, setForm] = useState(null)
  const refresh = () => { setStamp((s) => s + 1); onChanged() }
  const remove = async (url, name) => {
    if (!window.confirm(t('"{n}" o\'chirilsinmi?', { n: name }))) return
    try { await api.delete(url); refresh() } catch (e) { toast(errorText(e), true) }
  }
  const list = (title, rows, url, kind) => (
    <div className="table-wrap" style={{ boxShadow: 'none' }}>
      <div className="table-toolbar"><b>{t(title)}</b><span style={{ flex: 1 }} />
        {editable && <button className="btn primary small" onClick={() => setForm({ kind, item: null })}>+ {t("Qo'shish")}</button>}</div>
      <table className="t">
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.id}>
              <td><span className="chip-group" style={{ borderColor: r.color, color: r.color }}>{r.name}</span>{r.count !== undefined && <span className="small muted"> · {r.count}</span>}</td>
              <td className="num">{editable && <>
                <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ kind, item: r })} />{' '}
                <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(`${url}${r.id}/`, r.name)} />
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <Modal title={t('Guruhlar va holatlar')} onClose={onClose} wide>
      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {list('Guruhlar', groups.data, '/crm/groups/', 'group')}
        {list('Holatlar (voronka)', statuses.data, '/crm/statuses/', 'status')}
      </div>
      {form && (
        <EntityForm title={form.item ? form.item.name : t(form.kind === 'group' ? 'Yangi guruh' : 'Yangi holat')}
          url={form.kind === 'group' ? '/crm/groups/' : '/crm/statuses/'} item={form.item}
          fields={[
            { name: 'name', label: t('Nomi'), required: true },
            { name: 'color', label: t('Rang'), type: 'color' },
            ...(form.kind === 'status' ? [{ name: 'position', label: t('Tartib'), type: 'number' }] : []),
          ]}
          defaults={{ color: form.kind === 'group' ? '#2563eb' : '#f59e0b', position: 0 }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh() }} />
      )}
    </Modal>
  )
}

export default function CounterpartiesPage() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ search: '', group: '', status: '', kind: '', is_active: 'true', debt: false })
  const [xf, setXf] = useState({})
  const [stamp, setStamp] = useState(0)
  const [manage, setManage] = useState(false)
  const [fieldsMgr, setFieldsMgr] = useState(false)
  const groups = useFetch('/crm/groups/', { stamp })
  const statuses = useFetch('/crm/statuses/', { stamp })
  const users = useFetch('/auth/users-lookup/')
  const fields = useCustomFields('counterparty', stamp)
  const listFields = fields.filter((x) => x.show_in_list)
  const view = usePageSettings('counterparties', {
    columns: [...COLUMNS, ...listFields.map((x) => ({ key: `x_${x.key}`, label: x.name }))],
    sections: SECTIONS,
  })
  const params = useMemo(() => {
    const p = { with_debt: 1, stamp, ...Object.fromEntries(Object.entries(xf).filter(([, v]) => v !== '').map(([k, v]) => [`x_${k}`, v])) }
    for (const k of ['search', 'group', 'status', 'kind', 'is_active']) if (f[k]) p[k] = f[k]
    return p
  }, [f.search, f.group, f.status, f.kind, f.is_active, xf, stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error } = useFetch('/crm/counterparties/', params)

  const nz = (bag) => bag && (Number(bag.UZS) !== 0 || Number(bag.USD) !== 0)
  const rows = (data || []).filter((r) => !f.debt || nz(r.receivable) || nz(r.payable))
  const { rows: pageRows, pager } = usePager(rows, 50, JSON.stringify(f))
  const sum = (key) => rows.reduce((a, r) => ({ UZS: a.UZS + Number(r[key]?.UZS || 0), USD: a.USD + Number(r[key]?.USD || 0) }), { UZS: 0, USD: 0 })
  const show = view.show

  const remove = async (item) => {
    if (!window.confirm(t('"{n}" o\'chirilsinmi?', { n: item.name }))) return
    try { await api.delete(`/crm/counterparties/${item.id}/`); toast(t("O'chirildi")); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  const debtCell = (bag) => (
    <>
      {Number(bag?.UZS) ? <div className={Number(bag.UZS) < 0 ? 'green' : ''}>{money(bag.UZS, 'UZS')}</div> : null}
      {Number(bag?.USD) ? <div className={Number(bag.USD) < 0 ? 'green' : 'usd-line'}>{money(bag.USD, 'USD')}</div> : null}
      {!nz(bag) && <span className="muted">—</span>}
    </>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Kontragentlar')}</h1>
          <div className="page-sub">{t('Mijozlar, yetkazuvchilar, dilerlar — guruhlar bo\'yicha')}</div>
        </div>
        <span className="grow" />
        {canEdit(user, 'counterparties') && <button className="btn" onClick={() => setManage(true)}>{t('Guruhlar va holatlar')}</button>}
        {canCreate(user, 'counterparties') && <button className="btn primary" onClick={() => nav('/counterparties/new')}>+ {t('Kontragent')}</button>}
        <PageSettings view={view} extra={canEdit(user, 'settings') && (
          <button className="link-btn small" onClick={() => setFieldsMgr(true)}>{t("Qo'shimcha maydonlar…")}</button>
        )} />
      </div>

      {show('stats') && (
        <div className="stats">
          <Stat label={t('Kontragentlar')} value={rows.length} />
          <Stat label={t('Bizga qarzi (debitor)')} bag={sum('receivable')} />
          <Stat label={t('Bizning qarzimiz (kreditor)')} bag={sum('payable')} />
        </div>
      )}

      <div className="filters" style={{ marginBottom: 10 }}>
        <button className={'chip' + (!f.group ? ' on' : '')} onClick={() => setF({ ...f, group: '' })}>{t('Hammasi')}</button>
        {(groups.data || []).map((g) => (
          <button key={g.id} className={'chip' + (String(f.group) === String(g.id) ? ' on' : '')} onClick={() => setF({ ...f, group: String(f.group) === String(g.id) ? '' : g.id })}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: g.color, marginRight: 6 }} />{g.name} <span className="muted">{g.count}</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        {show('filters') && (
          <div className="table-toolbar filters">
            <input placeholder={t('Nomi, telefon, STIR…')} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} style={{ width: 220 }} />
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">{t('Holat: hammasi')}</option>
              {(statuses.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="">{t('Turi: hammasi')}</option>
              <option value="individual">{t('Jismoniy shaxs')}</option>
              <option value="legal">{t('Yuridik shaxs')}</option>
            </select>
            <select value={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.value })}>
              <option value="true">{t('Faollar')}</option><option value="false">{t('Nofaollar')}</option><option value="">{t('Hammasi')}</option>
            </select>
            {fields.filter((x) => x.filterable).map((x) => (
              <CustomFieldFilter key={x.id} f={x} value={xf[x.key]} users={users.data || []} onChange={(v) => setXf({ ...xf, [x.key]: v })} />
            ))}
            <button className={'chip' + (f.debt ? ' on' : '')} onClick={() => setF({ ...f, debt: !f.debt })}>{t('Qarzi borlar')}</button>
          </div>
        )}
        {!data ? <Loading error={error} /> : (
          <table className={view.tableClass}>
            <thead>
              <tr>
                <th>{t('Nomi')}</th>
                {show('status') && <th>{t('Holat')}</th>}
                {show('groups') && <th>{t('Guruhlar')}</th>}
                {show('phone') && <th>{t('Telefon')}</th>}
                {show('email') && <th>{t("Email")}</th>}
                {show('contact') && <th>{t("Mas'ul shaxs")}</th>}
                {show('inn') && <th>{t('STIR')}</th>}
                {show('address') && <th>{t('Manzil')}</th>}
                {show('owner') && <th>{t("Mas'ul xodim")}</th>}
                {listFields.filter((x) => show(`x_${x.key}`)).map((x) => <th key={x.id}>{x.name}</th>)}
                {show('orders') && <th className="num">{t('Buyurtmalar')}</th>}
                {show('receivable') && <th className="num">{t('Bizga qarzi')}</th>}
                {show('payable') && <th className="num">{t('Bizning qarzimiz')}</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => nav(`/counterparties/${r.id}`)}>
                  <td><div className="bold">{r.name}{!r.is_active && <span className="muted small"> ({t('nofaol')})</span>}</div><div className="small muted">{t(r.kind_display)}{r.code ? ` · ${r.code}` : ''}</div></td>
                  {show('status') && <td>{r.status_name ? <span className="status-pill" style={{ background: r.status_color }}>{r.status_name}</span> : '—'}</td>}
                  {show('groups') && <td>{r.group_list.map((g) => <span key={g.id} className="chip-group" style={{ borderColor: g.color, color: g.color, marginRight: 4 }}>{g.name}</span>)}</td>}
                  {show('phone') && <td>{r.phone || '—'}</td>}
                  {show('email') && <td>{r.email || '—'}</td>}
                  {show('contact') && <td>{r.contact_person || '—'}</td>}
                  {show('inn') && <td>{r.inn || '—'}</td>}
                  {show('address') && <td className="small">{r.address || '—'}</td>}
                  {show('owner') && <td>{r.owner_name || '—'}</td>}
                  {listFields.filter((x) => show(`x_${x.key}`)).map((x) => <td key={x.id}>{formatExtra(x, r.extra?.[x.key], users.data || [])}</td>)}
                  {show('orders') && <td className="num">{r.orders_count || '—'}</td>}
                  {show('receivable') && <td className="num bold">{debtCell(r.receivable)}</td>}
                  {show('payable') && <td className="num bold">{debtCell(r.payable)}</td>}
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    {canDelete(user, 'counterparties') && <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(r)} />}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={20} className="empty">{t('Topilmadi')}</td></tr>}
            </tbody>
          </table>
        )}
        {pager}
      </div>
      <div className="legend"><span>{t('Manfiy (yashil) qarz — avans (ortiqcha to\'lov).')}</span><span>{t("Hujjatlarda ishlatilgan kontragentni o'chirib bo'lmaydi — nofaol qiling.")}</span></div>
      {manage && <GroupsManager editable={canEdit(user, 'counterparties')} onClose={() => setManage(false)} onChanged={() => setStamp((s) => s + 1)} />}
      {fieldsMgr && (
        <Modal title={t("Qo'shimcha maydonlar")} onClose={() => { setFieldsMgr(false); setStamp((s) => s + 1) }} wide>
          <CustomFieldsManager entity="counterparty" />
        </Modal>
      )}
    </>
  )
}

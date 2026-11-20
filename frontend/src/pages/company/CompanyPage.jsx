import { useState } from 'react'
import api, { errorText } from '../../api'
import { can, canEdit, useAuth } from '../../auth'
import EntityForm from '../../components/EntityForm'
import { Badge, Field, Loading, Modal, toast, useFetch } from '../../components/ui'
import { date, money, num, todayISO } from '../../format'
import { AccessFields } from '../settings/SettingsPage'
import { t } from '../../i18n'
import Icon, { IconBtn } from '../../components/Icon'
import { curLabel, currencyOptions, baseCurrency } from '../../currency'
import History from './History'
import { confirmDialog } from '../../components/Confirm'
import { DateInput, NumInput } from '../../components/Inputs'

const TABS = [
  ['info', t("Kompaniya ma'lumotlari")],
  ['branches', t("Filiallar")],
  ['employees', t("Xodimlar")],
  ['departments', t("Bo'limlar")],
  ['warehouses', t("Omborlar")],
  ['accounts', t("Kassa va bank")],
  ['history', t("Tarix")],
]

/* ---------------- Ma'lumotlar ---------------- */
const COMPANY_FIELDS = [
  ['name', 'Qisqa nomi (tizimda ko\'rinadi)'], ['legal_name', t("Yuridik nomi")], ['inn', t("STIR")], ['oked', t("OKED")],
  ['vat_code', t("QQS kodi")], ['director', t("Rahbar")], ['accountant', t("Bosh hisobchi")], ['phone', t("Telefon")],
  ['email', t("Email")], ['website', t("Veb-sayt")], ['address', t("Yuridik manzil")],
  ['bank_name', t("Bank")], ['bank_mfo', t("MFO")], ['bank_account', t("Hisob raqam")],
]

function CompanyInfo({ editable }) {
  const { data, error, setData } = useFetch('/core/company/')
  const { reloadMe } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading error={error} />
  const set = (k) => (e) => setData({ ...data, [k]: e.target.value })

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = { ...data }
      delete payload.logo
      const { data: saved } = await api.patch('/core/company/', payload)
      setData(saved)
      toast("Kompaniya ma'lumotlari saqlandi")
    } catch (err) { toast(errorText(err), true) } finally { setBusy(false) }
  }
  const uploadLogo = async (file) => {
    const fd = new FormData()
    fd.append('logo', file)
    try {
      const { data: saved } = await api.patch('/core/company/', fd)
      setData(saved)
      toast('Logo yuklandi')
      reloadMe?.()
    } catch (err) { toast(errorText(err), true) }
  }
  const removeLogo = async () => {
    try {
      const { data: saved } = await api.patch('/core/company/', { logo: null })
      setData(saved)
      toast(t("Logo o'chirildi"))
      reloadMe?.()
    } catch (err) { toast(errorText(err), true) }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <h2 style={{ margin: 0 }}>{t("Rekvizitlar")}</h2>
        <div className="company-logo-box">
          {data.logo ? <img src={data.logo} alt="logo" /> : <span className="muted small">{t("Logo yuklanmagan")}</span>}
          {editable && (
            <label className="btn small">
              {data.logo ? t('Logoni almashtirish') : t('Logo yuklash')}
              <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) uploadLogo(e.target.files[0]); e.target.value = '' }} />
            </label>
          )}
          {editable && data.logo && <button type="button" className="btn small danger-ghost" onClick={removeLogo}>{t("O'chirish")}</button>}
        </div>
      </div>
      <div className="form three">
        {COMPANY_FIELDS.map(([k, l]) => (
          <Field key={k} label={l} full={k === 'address'}>
            <input value={data[k] || ''} onChange={set(k)} disabled={!editable} required={k === 'name'} />
          </Field>
        ))}
      </div>
      {editable && <div className="form-actions"><button className="btn primary" disabled={busy}>{t("Saqlash")}</button></div>}
    </form>
  )
}

/* ---------------- Xodimlar ---------------- */
const PAY_SYSTEMS = [['salary', t("Oklad")], ['piece', t("Ishbay")], ['salary_plan', t("Oklad+plan")]]

function EmployeeForm({ item, departments, roles, branches, user, onClose, onSaved }) {
  const hrEdit = canEdit(user, 'hr')
  const settingsEdit = canEdit(user, 'settings')
  const [v, setV] = useState(() => ({
    full_name: '', position: '', phone: '', hired_at: todayISO(), note: '',
    pay_system: 'salary', base_salary: '0', kpi_bonus_base: '0', is_active: true, ...(item || {}),
    department: item?.department ?? '', branch: item?.branch ?? (branches.find((b) => b.is_main)?.id || ''),
  }))
  const [access, setAccess] = useState(() => ({
    enabled: !!item?.access, username: item?.access?.username || '', password: '',
    role: item?.access?.role || '', is_active: item?.access?.is_active ?? true, branches: item?.access?.branches || [],
  }))
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const payload = { ...v, department: v.department || null, branch: v.branch || null, hired_at: v.hired_at || null }
    delete payload.access
    if (!hrEdit) { delete payload.base_salary; delete payload.kpi_bonus_base; delete payload.pay_system }
    try {
      const { data: emp } = item ? await api.patch(`/hr/employees/${item.id}/`, payload) : await api.post('/hr/employees/', payload)
      if (settingsEdit && access.enabled) {
        await api.post(`/hr/employees/${emp.id}/access/`, {
          username: access.username, password: access.password, role: access.role, is_active: access.is_active, branches: access.branches,
        })
      } else if (settingsEdit && !access.enabled && item?.access?.is_active) {
        await api.delete(`/hr/employees/${emp.id}/access/`)
      }
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }

  return (
    <Modal title={item ? item.full_name : 'Yangi xodim'} onClose={onClose} wide>
      {error && <div className="error">{error}</div>}
      <form className="form three" onSubmit={submit}>
        <div className="full section-title" style={{ marginTop: 0 }}>{t("Shaxsiy ma'lumotlar")}</div>
        <Field label={t("F.I.Sh.")}><input value={v.full_name} onChange={set('full_name')} required /></Field>
        <Field label={t("Lavozimi")}><input value={v.position} onChange={set('position')} /></Field>
        <Field label={t("Bo'lim")}>
          <select value={v.department ?? ''} onChange={set('department')}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={t("Filial")}>
          <select value={v.branch ?? ''} onChange={set('branch')}>
            <option value="">—</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label={t("Telefon")}><input value={v.phone} onChange={set('phone')} /></Field>
        <Field label={t("Ishga kirgan sana")}><DateInput value={v.hired_at || ''} onChange={set('hired_at')} /></Field>
        <div><label className="check" style={{ marginTop: 22 }}><input type="checkbox" checked={v.is_active} onChange={set('is_active')} /> {t("Ishlayapti (faol)")}</label></div>
        <Field label={t("Izoh")} full><input value={v.note} onChange={set('note')} /></Field>

        {can(user, 'hr') && (
          <>
            <div className="full section-title">{t("Ish haqi (so'm)")}</div>
            <Field label={t("Hisoblash tizimi")}>
              <select value={v.pay_system} onChange={set('pay_system')} disabled={!hrEdit}>
                {PAY_SYSTEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label={t("Oklad, oyiga")}><NumInput min="0" value={v.base_salary ?? ''} onChange={set('base_salary')} disabled={!hrEdit} /></Field>
            <Field label={t("KPI bonus bazasi")}><NumInput min="0" value={v.kpi_bonus_base ?? ''} onChange={set('kpi_bonus_base')} disabled={!hrEdit} /></Field>
          </>
        )}

        {settingsEdit && (
          <>
            <div className="full section-title">{t("Tizimga kirish")}</div>
            <div className="full">
              <label className="check">
                <input type="checkbox" checked={access.enabled} onChange={(e) => setAccess({ ...access, enabled: e.target.checked })} />
                Bu xodim tizimga kira oladi (login va rol beriladi)
              </label>
            </div>
            {access.enabled && <AccessFields access={access} setAccess={setAccess} roles={roles} branches={branches} isNew={!item?.access} />}
          </>
        )}

        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

function Employees({ editable, user }) {
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ search: '', department: '', is_active: 'true' })
  const [form, setForm] = useState(null)
  const params = Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, x]) => x !== ''))
  const { data, error } = useFetch('/hr/employees/', params)
  const deps = useFetch('/production/departments/')
  const roles = useFetch(can(user, 'settings') ? '/auth/roles/' : null)
  const branches = useFetch('/core/branches/')
  const showSalary = can(user, 'hr')

  return (
    <>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          {editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Xodim")}</button>}
          <input placeholder={t("Ism, telefon, lavozim…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">{t("Bo'lim: hammasi")}</option>
            {(deps.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.value })}>
            <option value="true">{t("Ishlayotganlar")}</option>
            <option value="false">{t("Bo'shaganlar")}</option>
            <option value="">{t("Hammasi")}</option>
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead>
              <tr>
                <th>{t("F.I.Sh.")}</th><th>{t("Lavozim")}</th><th>{t("Bo'lim")}</th><th>{t("Filial")}</th><th>{t("Telefon")}</th><th>{t("Ishga kirgan")}</th>
                {showSalary && <><th>{t("Tizim")}</th><th className="num">{t("Oklad")}</th></>}
                <th>{t("Tizimga kirish")}</th><th />
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className={editable ? 'clickable' : ''} onClick={() => editable && setForm({ item: e })}>
                  <td className="bold">{e.full_name}{!e.is_active && <span className="muted small"> {t("(bo'shagan)")}</span>}</td>
                  <td>{e.position || '—'}</td>
                  <td>{e.department_name || '—'}</td>
                  <td>{e.branch_name || '—'}</td>
                  <td>{e.phone || '—'}</td>
                  <td>{date(e.hired_at)}</td>
                  {showSalary && <><td className="small">{t(e.pay_system_display)}</td><td className="num">{Number(e.base_salary) ? num(e.base_salary) : '—'}</td></>}
                  <td>
                    {e.access
                      ? <><Badge kind={e.access.is_active ? 'confirmed' : 'neutral'}>{e.access.is_owner ? 'Egasi' : e.access.role_name || 'rolsiz'}</Badge> <span className="small muted">{e.access.username}</span></>
                      : <span className="muted small">{t("yo'q")}</span>}
                  </td>
                  <td className="num">{editable && <span className="icon-act" title={t("Tahrirlash")}><Icon name="edit" size={16} /></span>}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={10} className="empty">{t("Xodimlar yo'q")}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="legend">
        <span>{t("Login va rol berish — Sozlamalar huquqi bor foydalanuvchilarga.")}</span>
        <span>{t("Ish haqi maydonlari — \"KPI va oylik\" huquqi borlarga ko'rinadi.")}</span>
      </div>
      {form && (
        <EmployeeForm
          item={form.item}
          departments={deps.data || []}
          roles={roles.data || []}
          branches={branches.data || []}
          user={user}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Xodim saqlandi') }}
        />
      )}
    </>
  )
}

/* ---------------- Bo'limlar ---------------- */
function Departments({ editable }) {
  const [stamp, setStamp] = useState(0)
  const deps = useFetch('/production/departments/', { stamp })
  const [form, setForm] = useState(null)
  const refresh = () => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }
  const remove = async (url, name) => {
    if (!await confirmDialog(t('"{n}" o\'chirilsinmi?', { n: name }))) return
    try { await api.delete(url); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  if (!deps.data) return <Loading error={deps.error} />

  return (
    <>
      {editable && (
        <div className="filters" style={{ marginBottom: 10 }}>
          <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Bo'lim")}</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th className="num" style={{ width: 70 }}>{t('Tartib')}</th><th>{t("Bo'lim")}</th><th className="num">{t("Kunlik sig'im")}</th><th /></tr></thead>
          <tbody>
            {deps.data.map((d) => (
              <tr key={d.id} className={editable ? 'clickable' : ''} onClick={() => editable && setForm({ item: d })}>
                <td className="num muted">{d.sequence}</td>
                <td className="bold">{d.name}</td>
                <td className="num">{num(d.daily_capacity)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>{editable && <IconBtn icon="delete" danger title="O'chirish" onClick={() => remove(`/production/departments/${d.id}/`, d.name)} />}</td>
              </tr>
            ))}
            {!deps.data.length && <tr><td colSpan={4} className="empty">{t("Bo'limlar yo'q")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{t("Bosqichlar va ishbay stavkalar Ishlab chiqarish → Bosqichlar bo'limida; ishbay haq bosqichga biriktirilgan xodimga yoziladi.")}</span></div>
      {form && (
        <EntityForm
          title={form.item ? form.item.name : "Yangi bo'lim"} url="/production/departments/" item={form.item}
          fields={[
            { name: 'name', label: t("Nomi"), required: true },
            { name: 'sequence', label: t("Texnologik tartib (10, 20, …)"), type: 'number', required: true },
            { name: 'daily_capacity', label: t("Kunlik sig'im"), type: 'number' },
          ]}
          defaults={{ sequence: (deps.data.length + 1) * 10, daily_capacity: 0 }}
          onClose={() => setForm(null)} onSaved={refresh}
        />
      )}
    </>
  )
}

/* ---------------- Filiallar ---------------- */
function Branches({ editable }) {
  const { reloadMe } = useAuth()
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/core/branches/', { stamp })
  const [form, setForm] = useState(null)
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="table-wrap" style={{ maxWidth: 900 }}>
        <div className="table-toolbar">{editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Filial")}</button>}</div>
        <table className="t">
          <thead><tr><th>{t("Nomi")}</th><th>{t("Manzil")}</th><th>{t("Telefon")}</th><th>{t("Holat")}</th><th /></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id}>
                <td className="bold">{b.name}{b.is_main && <span className="badge b-confirmed" style={{ marginLeft: 8 }}>{t("bosh")}</span>}</td>
                <td>{b.address || '—'}</td>
                <td>{b.phone || '—'}</td>
                <td><Badge kind={b.is_active ? 'ok' : 'neutral'}>{b.is_active ? 'Faol' : 'Yopilgan'}</Badge></td>
                <td className="num">{editable && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: b })} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend"><span>{t("Buyurtma, sotuv, ombor, kassa va xodimlar filialga bog'lanadi.")}</span><span>{t("Yuqori paneldagi filial tanlovi orqali ma'lumotlar filial bo'yicha ko'rinadi.")}</span></div>
      {form && (
        <EntityForm title={form.item ? form.item.name : 'Yangi filial'} url="/core/branches/" item={form.item}
          fields={[
            { name: 'name', label: t("Nomi"), required: true },
            { name: 'phone', label: t("Telefon") },
            { name: 'address', label: t("Manzil"), full: true },
            { name: 'is_main', label: t("Bosh filial"), type: 'checkbox' },
            { name: 'is_active', label: t("Faol"), type: 'checkbox' },
          ]}
          defaults={{ is_active: true }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); reloadMe(); toast('Filial saqlandi') }} />
      )}
    </>
  )
}

/* ---------------- Omborlar ---------------- */
// eslint-disable-next-line react-refresh/only-export-components
export function Warehouses({ editable }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/warehouse/warehouses/', { stamp })
  const branches = useFetch('/core/branches/')
  const [form, setForm] = useState(null)
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="table-wrap" style={{ maxWidth: 600 }}>
        <div className="table-toolbar">{editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Ombor")}</button>}</div>
        <table className="t">
          <thead><tr><th>{t("Nomi")}</th><th>{t("Filial")}</th><th /></tr></thead>
          <tbody>
            {data.map((w) => (
              <tr key={w.id}><td className="bold">{w.name}{!w.is_active && <span className="muted small"> {t("(nofaol)")}</span>}</td><td>{w.branch_name || '—'}</td><td className="num">{editable && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: w })} />}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <EntityForm title={form.item ? form.item.name : 'Yangi ombor'} url="/warehouse/warehouses/" item={form.item}
          fields={[{ name: 'name', label: t("Nomi"), required: true, full: true },
            { name: 'branch', label: t("Filial"), type: 'select', options: (branches.data || []).map((b) => [b.id, b.name]) },
            { name: 'is_active', label: t("Faol"), type: 'checkbox' }]}
          defaults={{ is_active: true }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />
      )}
    </>
  )
}

/* ---------------- Kassa va bank ---------------- */
function Accounts({ user }) {
  const editable = canEdit(user, 'finance')
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch(can(user, 'finance') ? '/finance/accounts/' : null, { stamp })
  const branches = useFetch('/core/branches/')
  const [form, setForm] = useState(null)
  if (!can(user, 'finance')) return <div className="card empty">{t("Kassa va bank hisoblarini ko'rish uchun \"Moliya\" huquqi kerak.")}</div>
  if (!data) return <Loading error={error} />
  return (
    <>
      <div className="table-wrap" style={{ maxWidth: 900 }}>
        <div className="table-toolbar">{editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Hisob")}</button>}</div>
        <table className="t">
          <thead><tr><th>{t("Nomi")}</th><th>{t("Filial")}</th><th>{t("Turi")}</th><th>{t("Valyuta")}</th><th className="num">{t("Boshlang'ich qoldiq")}</th><th className="num">{t("Joriy qoldiq")}</th><th>{t("Holat")}</th><th /></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="bold">{a.name}</td>
                <td>{a.branch_name || <span className="muted">{t("umumiy")}</span>}</td>
                <td>{a.kind === 'cash' ? 'Kassa' : 'Bank'}</td>
                <td>{curLabel(a.currency)}</td>
                <td className="num">{money(a.opening_balance, a.currency)}</td>
                <td className="num bold">{money(a.balance, a.currency)}</td>
                <td><Badge kind={a.is_active ? 'ok' : 'neutral'}>{a.is_active ? 'Faol' : 'Yopilgan'}</Badge></td>
                <td className="num">{editable && <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: a })} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <EntityForm title={form.item ? form.item.name : 'Yangi hisob'} url="/finance/accounts/" item={form.item}
          fields={[
            { name: 'name', label: t("Nomi"), required: true, full: true },
            { name: 'kind', label: t("Turi"), type: 'select', options: [['cash', t("Kassa")], ['bank', t("Bank")]], noEmpty: true },
            { name: 'currency', label: t("Valyuta"), type: 'select', options: currencyOptions(), noEmpty: true, readOnly: !!form.item },
            { name: 'branch', label: 'Filial (bo\'sh — umumiy)', type: 'select', options: (branches.data || []).map((b) => [b.id, b.name]) },
            { name: 'opening_balance', label: t("Boshlang'ich qoldiq"), type: 'number' },
            { name: 'is_active', label: t("Faol"), type: 'checkbox' },
          ]}
          defaults={{ kind: 'cash', currency: baseCurrency(), opening_balance: 0, is_active: true }}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />
      )}
    </>
  )
}

export default function CompanyPage() {
  const { user } = useAuth()
  const editable = canEdit(user, 'company')
  const [tab, setTab] = useState(() => sessionStorage.getItem('company.tab') || 'info')
  const pick = (k) => { setTab(k); sessionStorage.setItem('company.tab', k) }
  return (
    <>
      <div className="page-head"><div><h1>{t("Kompaniya")}</h1><div className="page-sub">{t("Rekvizitlar, filiallar, xodimlar va tuzilma")}</div></div></div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={'btn' + (tab === k ? ' active' : '')} onClick={() => pick(k)}>{l}</button>)}
      </div>
      {tab === 'info' && <CompanyInfo editable={editable} />}
      {tab === 'branches' && <Branches editable={editable} />}
      {tab === 'employees' && <Employees editable={editable || canEdit(user, 'hr')} user={user} />}
      {tab === 'departments' && <Departments editable={editable} />}
      {tab === 'warehouses' && <Warehouses editable={editable} />}
      {tab === 'accounts' && <Accounts user={user} />}
      {tab === 'history' && <History />}
    </>
  )
}

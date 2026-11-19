import { useEffect, useState } from 'react'
import api, { errorText } from '../../api'
import { canEdit, useAuth } from '../../auth'
import { CustomFieldsManager } from '../../components/CustomFields'
import EntityForm from '../../components/EntityForm'
import Icon, { IconBtn } from '../../components/Icon'
import { Badge, Field, Loading, Modal, toast, useFetch, DialogMode } from '../../components/ui'
import { date } from '../../format'
import { t } from '../../i18n'
import Currencies from './Currencies'

const SECTIONS = [
  { grp: 'Jamoa', items: [['users', t("Foydalanuvchilar"), 'user'], ['roles', t("Rollar va huquqlar"), 'roles']] },
  { grp: 'Tizim', items: [['general', t("Umumiy sozlamalar"), 'sliders'], ['fields', t("Qo'shimcha maydonlar"), 'orders'], ['rates', t("Valyutalar"), 'currency'], ['refs', t("Ma'lumotnomalar"), 'book']] },
]
const ACTIONS = [['view', t("Ko'rish")], ['create', t("Yaratish")], ['edit', t("Tahrirlash")], ['delete', t("O'chirish")]]

/** Login / parol / rol / filiallar — Kompaniya → Xodim formasida ham ishlatiladi */
// eslint-disable-next-line react-refresh/only-export-components
export function AccessFields({ access, setAccess, roles, isNew, branches = [] }) {
  const toggleBranch = (id) => {
    const set = new Set(access.branches || [])
    set.has(id) ? set.delete(id) : set.add(id)
    setAccess({ ...access, branches: [...set] })
  }
  return (
    <>
      <Field label={t("Login")}>
        <input value={access.username} onChange={(e) => setAccess({ ...access, username: e.target.value.trim() })} required autoComplete="off" />
      </Field>
      <Field label={isNew ? 'Parol (kamida 8 belgi)' : "Yangi parol (o'zgartirmasangiz bo'sh qoldiring)"}>
        <input type="password" value={access.password} onChange={(e) => setAccess({ ...access, password: e.target.value })} required={isNew} autoComplete="new-password" />
      </Field>
      <Field label={t("Rol")}>
        <select value={access.role} onChange={(e) => setAccess({ ...access, role: e.target.value })} required>
          <option value="">{t("— tanlang —")}</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {branches.length > 1 && (
        <div className="full">
          <div className="small muted" style={{ marginBottom: 6 }}>{t("Ruxsat etilgan filiallar (hech biri belgilanmasa — barcha filiallar)")}</div>
          <div className="filters">
            {branches.map((b) => (
              <button key={b.id} type="button" className={'chip' + ((access.branches || []).includes(b.id) ? ' on' : '')} onClick={() => toggleBranch(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="full">
        <label className="check">
          <input type="checkbox" checked={access.is_active} onChange={(e) => setAccess({ ...access, is_active: e.target.checked })} />
          Faol (o'chirilsa — tizimga kira olmaydi)
        </label>
      </div>
    </>
  )
}

/* ---------------- Foydalanuvchilar ---------------- */
function GrantAccess({ roles, branches, employee, onClose, onSaved }) {
  const emps = useFetch(employee ? null : '/hr/employees/', { is_active: true })
  const [emp, setEmp] = useState(employee?.id || '')
  const [access, setAccess] = useState(() => ({
    username: employee?.access?.username || '', password: '', role: employee?.access?.role || '',
    is_active: employee?.access?.is_active ?? true, branches: employee?.access?.branches || [],
  }))
  const [error, setError] = useState(null)
  const candidates = (emps.data || []).filter((e) => !e.access)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/hr/employees/${emp}/access/`, access)
      onSaved()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={employee ? `${employee.full_name}: tizimga kirish` : 'Xodimga tizimga kirish berish'} onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <form className="form" onSubmit={submit}>
        {!employee && (
          <Field label={t("Xodim")} full>
            <select value={emp} onChange={(e) => setEmp(e.target.value)} required>
              <option value="">{t("— loginsiz xodimlar —")}</option>
              {candidates.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` · ${e.position}` : ''}</option>)}
            </select>
          </Field>
        )}
        <AccessFields access={access} setAccess={setAccess} roles={roles} branches={branches} isNew={!employee?.access} />
        {!employee && <p className="hint full" style={{ margin: 0 }}>{t("Xodim ro'yxatda bo'lmasa — avval Kompaniya → Xodimlar bo'limida qo'shing.")}</p>}
        <div className="full form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
          <button className="btn primary">{t("Saqlash")}</button>
        </div>
      </form>
    </Modal>
  )
}

function Users({ roles, branches, editable }) {
  const { user: me } = useAuth()
  const [stamp, setStamp] = useState(0)
  const [f, setF] = useState({ role: '', is_active: 'true', search: '' })
  const params = Object.fromEntries(Object.entries({ ...f, stamp }).filter(([, v]) => v !== ''))
  const { data, error } = useFetch('/auth/users/', params)
  const [grant, setGrant] = useState(false)
  const [pwFor, setPwFor] = useState(null)
  const [branchFor, setBranchFor] = useState(null)
  const reload = () => setStamp((s) => s + 1)

  const patch = async (u, body, msg) => {
    try {
      await api.patch(`/auth/users/${u.id}/`, body)
      toast(msg)
      reload()
    } catch (e) { toast(errorText(e), true) }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>{t("Foydalanuvchilar")}</h1><div className="page-sub">{t("Tizimga kira oladigan xodimlar, ularning roli va filiallari")}</div></div>
        <span className="grow" />
        {editable && <button className="btn primary" onClick={() => setGrant(true)}>{t("+ Foydalanuvchi")}</button>}
      </div>
      <div className="table-wrap">
        <div className="table-toolbar filters">
          <input placeholder={t("Login yoki ism…")} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="">{t("Rol: hammasi")}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.value })}>
            <option value="true">{t("Faollar")}</option><option value="false">{t("Bloklanganlar")}</option><option value="">{t("Hammasi")}</option>
          </select>
        </div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <thead><tr><th>{t("Foydalanuvchi")}</th><th>{t("Rol")}</th><th>{t("Filiallar")}</th><th>{t("Oxirgi kirish")}</th><th>{t("Holat")}</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="avatar">{(u.full_name || u.username)[0].toUpperCase()}</span>
                      <div>
                        <div className="bold">{u.employee?.full_name || u.full_name}{u.is_owner && <span className="badge b-near_min" style={{ marginLeft: 6 }}>{t("egasi")}</span>}</div>
                        <div className="small muted">{u.username}{u.employee?.position ? ` · ${u.employee.position}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {editable && !u.is_owner ? (
                      <select className="chip" value={u.role || ''} onChange={(e) => patch(u, { role: e.target.value || null }, "Rol o'zgartirildi")}>
                        <option value="">{t("— rolsiz —")}</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : (u.is_owner ? 'Barcha huquqlar' : u.role_name)}
                  </td>
                  <td className="small">
                    {u.branch_names.length ? u.branch_names.join(', ') : <span className="muted">{t("barchasi")}</span>}
                    {editable && branches.length > 1 && <> <IconBtn icon="edit" size={14} title="Filiallarni o\'zgartirish" onClick={() => setBranchFor(u)} /></>}
                  </td>
                  <td className="small">{u.last_login ? date(u.last_login) : <span className="muted">{t("hech qachon")}</span>}</td>
                  <td><Badge kind={u.is_active ? 'ok' : 'low'}>{u.is_active ? 'Faol' : 'Bloklangan'}</Badge></td>
                  <td className="num">
                    {editable && (
                      <>
                        <IconBtn icon="key" title="Parolni o\'zgartirish" onClick={() => setPwFor(u)} />
                        {u.id !== me.id && !u.is_owner && (
                          <IconBtn icon={u.is_active ? 'lock' : 'check'} danger={u.is_active} title={u.is_active ? 'Bloklash' : 'Faollashtirish'} onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? 'Bloklandi' : 'Faollashtirildi')} />
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="legend"><span>{t("Foydalanuvchi o'chirilmaydi — tarix saqlanishi uchun bloklanadi.")}</span><span>{t("Kompaniya egasi har doim barcha huquqlarga ega.")}</span></div>
      {grant && <GrantAccess roles={roles} branches={branches} onClose={() => setGrant(false)} onSaved={() => { setGrant(false); reload(); toast('Tizimga kirish berildi') }} />}
      {pwFor && (
        <EntityForm dialog title={`${pwFor.username}: yangi parol`} url={`/auth/users/${pwFor.id}/set_password/`} item={null}
          fields={[{ name: 'password', label: t("Yangi parol (kamida 8 belgi)"), type: 'password', required: true, full: true }]}
          onClose={() => setPwFor(null)} onSaved={() => { setPwFor(null); toast("Parol o'zgartirildi") }} />
      )}
      {branchFor && (
        <BranchPicker user={branchFor} branches={branches} onClose={() => setBranchFor(null)}
          onSave={(ids) => { setBranchFor(null); patch(branchFor, { branches: ids }, 'Filiallar saqlandi') }} />
      )}
    </>
  )
}

function BranchPicker({ user, branches, onClose, onSave }) {
  const [sel, setSel] = useState(() => user.branches || [])
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  return (
    <Modal title={`${user.username}: filiallar`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{t("Hech biri belgilanmasa — foydalanuvchi barcha filiallarni ko'radi.")}</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {branches.map((b) => (
          <label key={b.id} className="check"><input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} /> {b.name}{b.is_main && <span className="small muted"> {t("(bosh)")}</span>}</label>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn ghost" onClick={onClose}>{t("Bekor")}</button>
        <button className="btn primary" onClick={() => onSave(sel)}>{t("Saqlash")}</button>
      </div>
    </Modal>
  )
}

/* ---------------- Rollar va huquqlar ---------------- */
const FULL = { view: true, create: true, edit: true, delete: true, post: true }
const VIEW = { view: true, create: false, edit: false, delete: false, post: false }
const NONE = { view: false, create: false, edit: false, delete: false, post: false }
const PERM_COLS = [['create', t('Yaratish')], ['edit', t('Tahrirlash')], ['delete', t("O'chirish")], ['post', t("O'tkazish")]]

function Roles({ editable, onChanged }) {
  const { reloadMe } = useAuth()
  const [stamp, setStamp] = useState(0)
  const roles = useFetch('/auth/roles/', { stamp })
  const meta = useFetch('/auth/modules/')
  const [selId, setSelId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [newRole, setNewRole] = useState(false)
  const [section, setSection] = useState(0)

  const sel = (roles.data || []).find((r) => r.id === selId) || roles.data?.[0]
  useEffect(() => { if (sel) setDraft(JSON.parse(JSON.stringify(sel))) }, [sel?.id, stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!roles.data || !meta.data || !draft) return <Loading error={roles.error || meta.error} />
  const dirty = JSON.stringify(draft) !== JSON.stringify(sel)
  const P = draft.permissions
  const allModules = meta.data.groups.flatMap((g) => g.modules.map((m) => m.key))

  const setCell = (m, action, value) => {
    const cur = { ...P[m], [action]: value }
    if (action === 'view' && !value) Object.assign(cur, { create: false, edit: false, delete: false, post: false })
    if (action !== 'view' && value) cur.view = true
    setDraft({ ...draft, permissions: { ...P, [m]: cur } })
  }
  const setModules = (mods, preset) => {
    const next = { ...P }
    mods.forEach((m) => { next[m] = { ...next[m], ...preset } })
    setDraft({ ...draft, permissions: next })
  }
  const columnAll = (mods, action) => mods.every((m) => P[m]?.[action])
  const toggleColumn = (mods, action) => {
    const value = !columnAll(mods, action)
    const next = { ...P }
    mods.forEach((m) => {
      const cur = { ...next[m], [action]: value }
      if (action === 'view' && !value) Object.assign(cur, { create: false, edit: false, delete: false, post: false })
      if (action !== 'view' && value) cur.view = true
      next[m] = cur
    })
    setDraft({ ...draft, permissions: next })
  }

  const save = async () => {
    try {
      await api.patch(`/auth/roles/${draft.id}/`, {
        name: draft.name, description: draft.description, permissions: draft.permissions, own_department_only: draft.own_department_only,
      })
      toast('Rol saqlandi')
      setStamp((s) => s + 1)
      onChanged()
      reloadMe()
    } catch (e) { toast(errorText(e), true) }
  }
  const remove = async () => {
    if (!window.confirm(`"${draft.name}" roli o'chirilsinmi?`)) return
    try {
      await api.delete(`/auth/roles/${draft.id}/`)
      setSelId(null)
      setStamp((s) => s + 1)
      onChanged()
    } catch (e) { toast(errorText(e), true) }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>{t("Rollar va huquqlar")}</h1><div className="page-sub">{t("Har bir rol qaysi bo'limlarni ko'rishi va nima qila olishini belgilang")}</div></div>
        <span className="grow" />
        {editable && <button className="btn primary" onClick={() => setNewRole(true)}>{t("+ Rol")}</button>}
      </div>
      <div className="role-chips">
        {roles.data.map((r) => (
          <button key={r.id} className={'role-chip' + (r.id === draft.id ? ' active' : '')} onClick={() => setSelId(r.id)}>
            <b>{r.name}</b><small>{t('{n} foydalanuvchi', { n: r.users_count })}{r.is_system ? ` · ${t('tizim')}` : ''}</small>
          </button>
        ))}
      </div>
      <div>
        <div className="card">
          <div className="form" style={{ marginBottom: 14 }}>
            <Field label={t("Rol nomi")}><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={!editable} /></Field>
            <Field label={t("Tavsif")}><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} disabled={!editable} /></Field>
          </div>
          {editable && (
            <div className="filters" style={{ marginBottom: 12 }}>
              <span className="small muted">{t("Butun rol:")}</span>
              <button className="chip" onClick={() => setModules(allModules, FULL)}>{t("Hammasi")}</button>
              <button className="chip" onClick={() => setModules(allModules, VIEW)}>{t("Faqat ko'rish")}</button>
              <button className="chip" onClick={() => setModules(allModules, NONE)}>{t("Hech narsa")}</button>
            </div>
          )}
          <div className="access">
            <div className="access-nav">
              {meta.data.groups.map((g, i) => {
                const on = g.modules.filter((m) => P[m.key]?.view).length
                return (
                  <button key={g.title} className={'access-sec' + (i === section ? ' active' : '')} onClick={() => setSection(i)}>
                    <span>{t(g.title)}</span>
                    <small className={on ? (on === g.modules.length ? 'full' : 'part') : ''}>{on}/{g.modules.length}</small>
                  </button>
                )
              })}
            </div>
            {(() => {
              const g = meta.data.groups[section] || meta.data.groups[0]
              const mods = g.modules.map((m) => m.key)
              const postable = meta.data.postable || []
              return (
                <div className="access-body">
                  <div className="access-head">
                    <h3>{t(g.title)}</h3>
                    {editable && (
                      <div className="filters">
                        <button className="chip" onClick={() => setModules(mods, FULL)}>{t("Hammasi")}</button>
                        <button className="chip" onClick={() => setModules(mods, VIEW)}>{t("Faqat ko'rish")}</button>
                        <button className="chip" onClick={() => setModules(mods, NONE)}>{t("Hech narsa")}</button>
                      </div>
                    )}
                  </div>
                  <table className="t perm-table">
                    <thead>
                      <tr>
                        <th />
                        <th>{t("Ko'rish")}</th>
                        {PERM_COLS.map(([k, l]) => (
                          <th key={k} className="c">
                            {l}
                            {editable && <div><input type="checkbox" checked={columnAll(mods.filter((m) => k !== 'post' || postable.includes(m)), k) && mods.some((m) => k !== 'post' || postable.includes(m))}
                              onChange={() => toggleColumn(mods.filter((m) => k !== 'post' || postable.includes(m)), k)} title={t("Ustun bo'yicha hammasi")} /></div>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.modules.map((m) => {
                        const p = P[m.key] || {}
                        const scoped = meta.data.scoped.includes(m.key)
                        const viewVal = !p.view ? 'none' : (scoped && p.scope === 'own' ? 'own' : 'all')
                        return (
                          <tr key={m.key}>
                            <td className="bold">{t(m.label)}</td>
                            <td>
                              <select className="perm-select" value={viewVal} disabled={!editable}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === 'none') return setCell(m.key, 'view', false)
                                  setDraft({ ...draft, permissions: { ...P, [m.key]: { ...p, view: true, scope: val === 'own' ? 'own' : 'all' } } })
                                }}>
                                <option value="none">{t("Yo'q")}</option>
                                <option value="all">{t('Hammasi')}</option>
                                {scoped && <option value="own">{t("Faqat o'zinikini")}</option>}
                              </select>
                            </td>
                            {PERM_COLS.map(([a]) => (
                              <td key={a} className="c">
                                {a === 'post' && !postable.includes(m.key) ? <span className="muted">—</span>
                                  : <input type="checkbox" disabled={!editable} checked={!!p[a]} onChange={(e) => setCell(m.key, a, e.target.checked)} />}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="hint">{t("\"Faqat o'zinikini\" — foydalanuvchi o'zi mas'ul yoki yaratgan hujjatlarni ko'radi. \"O'tkazish\" — hujjatni qoldiqqa o'tkazish / bekor qilish (MoySklad: Проводить).")}</div>
                </div>
              )
            })()}
          </div>
          <label className="check" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={draft.own_department_only} disabled={!editable}
              onChange={(e) => setDraft({ ...draft, own_department_only: e.target.checked })} />
            Ishlab chiqarishda faqat o'z bo'limi topshiriqlarini ko'radi (bo'lim boshlig'i uchun)
          </label>
          {editable && (
            <div className="form-actions">
              {draft.code !== 'admin' && <button className="btn danger" onClick={remove}>{t("Rolni o'chirish")}</button>}
              <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(JSON.parse(JSON.stringify(sel)))}>{t("Bekor")}</button>
              <button className="btn primary" disabled={!dirty} onClick={save}>{t("Saqlash")}</button>
            </div>
          )}
        </div>
      </div>

      {newRole && (
        <EntityForm title={t("Yangi rol")} url="/auth/roles/" item={null}
          fields={[
            { name: 'name', label: t("Nomi"), required: true },
            { name: 'code', label: t("Kod (lotincha, masalan: kassir2)"), required: true },
            { name: 'description', label: t("Tavsif"), full: true },
          ]}
          defaults={{ permissions: {} }}
          onClose={() => setNewRole(false)}
          onSaved={(r) => { setNewRole(false); setStamp((s) => s + 1); setSelId(r.id); onChanged() }} />
      )}
    </>
  )
}

/* ---------------- Umumiy sozlamalar ---------------- */
const GENERAL = [
  { name: 'order_number_start', label: t("Buyurtma raqamlari shu sondan keyin boshlanadi"), type: 'number' },
  { name: 'sale_number_start', label: t("Sotuv raqamlari shu sondan keyin boshlanadi"), type: 'number' },
  { name: 'daily_capacity', label: t("Kalendar: kunlik sig'im, m²"), type: 'number', hint: "Yuklama % = kun hajmi / sig'im" },
  { name: 'stock_near_min_ratio', label: t("Ombor: \"Minimalga yaqin\" koeffitsiyenti"), type: 'number', hint: 'Mavjud ≤ minimal × koeff. → ogohlantirish' },
  { name: 'defect_norm_pct', label: t("Brak me'yori, %"), type: 'number' },
  { name: 'working_days', label: t("Oydagi ish kunlari normasi"), type: 'number' },
  { name: 'kanban_delivered_days', label: t("Kanban: topshirilganlar necha kun ko'rinadi"), type: 'number' },
  { name: 'allow_negative_stock', label: t("Sotuvda qoldiqdan ko'p sotishga ruxsat (manfiy qoldiq)"), type: 'checkbox' },
]

function General({ editable }) {
  const { data, error, setData } = useFetch('/core/settings/')
  if (!data) return <Loading error={error} />
  const save = async (e) => {
    e.preventDefault()
    try {
      const { data: saved } = await api.patch('/core/settings/', data)
      setData(saved)
      toast('Sozlamalar saqlandi')
    } catch (err) { toast(errorText(err), true) }
  }
  return (
    <>
      <div className="page-head"><div><h1>{t("Umumiy sozlamalar")}</h1><div className="page-sub">{t("Biznes qoidalari — kodda emas, shu yerda boshqariladi")}</div></div></div>
      <form className="card" style={{ maxWidth: 860 }} onSubmit={save}>
        <div className="form">
          {GENERAL.map((g) => (g.type === 'checkbox' ? (
            <label key={g.name} className="check full"><input type="checkbox" checked={!!data[g.name]} disabled={!editable}
              onChange={(e) => setData({ ...data, [g.name]: e.target.checked })} /> {g.label}</label>
          ) : (
            <Field key={g.name} label={g.label}>
              {g.type === 'select' ? (
                <select value={data[g.name]} onChange={(e) => setData({ ...data, [g.name]: e.target.value })} disabled={!editable}>
                  {g.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input type="number" step="any" value={data[g.name]} onChange={(e) => setData({ ...data, [g.name]: e.target.value })} disabled={!editable} />
              )}
              {g.hint && <span className="small muted">{g.hint}</span>}
            </Field>
          )))}
        </div>
        {editable && <div className="form-actions"><button className="btn primary">{t("Saqlash")}</button></div>}
      </form>
    </>
  )
}

/* ---------------- Qo'shimcha maydonlar ---------------- */
function FieldsSection({ editable }) {
  const [entity, setEntity] = useState('order')
  return (
    <>
      <div className="page-head">
        <div><h1>{t("Qo'shimcha maydonlar")}</h1><div className="page-sub">{t("Hujjatlarga o'zingizning maydonlaringizni qo'shing — formada, ro'yxat ustunida va filtrda ko'rinadi")}</div></div>
        <span className="grow" />
        <div className="segmented">
          {[['order', t("Buyurtmalar")], ['counterparty', t("Kontragentlar")], ['sale', t("Sotuvlar")]].map(([k, l]) => (
            <button key={k} className={entity === k ? 'active' : ''} onClick={() => setEntity(k)}>{l}</button>
          ))}
        </div>
      </div>
      <CustomFieldsManager key={entity} entity={entity} editable={editable} embedded />
    </>
  )
}

/* ---------------- Ma'lumotnomalar ---------------- */
function References({ user }) {
  const [stamp, setStamp] = useState(0)
  const { data, error } = useFetch('/finance/categories/', { stamp })
  const [form, setForm] = useState(null)
  const editable = canEdit(user, 'settings') || canEdit(user, 'finance')
  const remove = async (item) => {
    if (!window.confirm(`"${item.name}" o'chirilsinmi?`)) return
    try { await api.delete(`/finance/categories/${item.id}/`); setStamp((s) => s + 1) } catch (e) { toast(errorText(e), true) }
  }
  return (
    <>
      <div className="page-head"><div><h1>{t("Ma'lumotnomalar")}</h1><div className="page-sub">{t("Xarajat moddalari: foyda-zararga ta'sir qiladi yoki qilmaydi. Tovar guruhlari va narx turlari — \"Tovarlar\" bo'limida.")}</div></div></div>
      <div className="table-wrap" style={{ maxWidth: 760 }}>
        <div className="table-toolbar"><b>{t("Xarajat moddalari")}</b><span style={{ flex: 1 }} />
          {editable && <button className="btn primary small" onClick={() => setForm({ item: null })}>{t("+ Qo'shish")}</button>}</div>
        {!data ? <Loading error={error} /> : (
          <table className="t">
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.affects_profit ? <Badge kind="ok">{t("foydaga ta'sir qiladi")}</Badge> : <Badge kind="neutral">{t("foydaga ta'sir qilmaydi")}</Badge>}</td>
                  <td className="num">{editable && <>
                    <IconBtn icon="edit" title="Tahrirlash" onClick={() => setForm({ item: r })} />{' '}
                    <IconBtn icon="delete" danger title="O\'chirish" onClick={() => remove(r)} />
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {form && <EntityForm title={form.item ? form.item.name : 'Xarajat turi'} url="/finance/categories/" item={form.item}
        fields={[{ name: 'name', label: t("Nomi"), required: true, full: true }, { name: 'affects_profit', label: t("Foydaga ta'sir qiladi (Foyda va zarar hisobotiga kiradi)"), type: 'checkbox', full: true }]}
        defaults={{ affects_profit: true }}
        onClose={() => setForm(null)} onSaved={() => { setForm(null); setStamp((s) => s + 1); toast('Saqlandi') }} />}
    </>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const editable = canEdit(user, 'settings')
  const [tab, setTab] = useState(() => sessionStorage.getItem('settings.tab') || 'users')
  const [stamp, setStamp] = useState(0)
  const roles = useFetch('/auth/roles/', { stamp })
  const branches = useFetch('/core/branches/')
  const pick = (k) => { setTab(k); sessionStorage.setItem('settings.tab', k) }
  return (
    <DialogMode.Provider value>
    <div className="settings-layout">
      <nav className="settings-nav">
        <div style={{ padding: '6px 10px 4px', fontWeight: 700, fontSize: 18 }}>{t("Sozlamalar")}</div>
        {SECTIONS.map((s) => (
          <div key={s.grp}>
            <div className="grp">{s.grp}</div>
            {s.items.map(([k, l, ic]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => pick(k)}>
                <span className="ic"><Icon name={ic} size={16} /></span>{l}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div>
        {tab === 'users' && <Users roles={roles.data || []} branches={branches.data || []} editable={editable} />}
        {tab === 'roles' && <Roles editable={editable} onChanged={() => setStamp((s) => s + 1)} />}
        {tab === 'general' && <General editable={editable} />}
        {tab === 'fields' && <FieldsSection editable={editable} />}
        {tab === 'rates' && <Currencies editable={editable || canEdit(user, 'finance')} />}
        {tab === 'refs' && <References user={user} />}
      </div>
    </div>
    </DialogMode.Provider>
  )
}

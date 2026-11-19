// Sozlamalar → Mening profilim (har bir foydalanuvchi o'zi uchun) va foydalanuvchini tahrirlash oynasi (admin).
import { useRef, useState } from 'react'
import api, { errorText } from '../../api'
import { useAuth } from '../../auth'
import { Badge, Field, Modal, toast } from '../../components/ui'
import { date } from '../../format'
import { t } from '../../i18n'

export function Avatar({ user, size = 36 }) {
  const name = user?.employee?.full_name || user?.full_name || user?.username || '?'
  return user?.avatar_url
    ? <img className="avatar avatar-img" src={user.avatar_url} alt="" style={{ width: size, height: size }} />
    : <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name[0].toUpperCase()}</span>
}

/* ------------------------------------------------------------ Mening profilim */
export function MyProfile() {
  const { user, reloadMe } = useAuth()
  const [v, setV] = useState({ full_name: user.full_name || '', phone: user.phone || '', email: user.email || '' })
  const [pw, setPw] = useState({ old_password: '', new_password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const reload = async () => { try { await reloadMe?.() } catch { /* ignore */ } }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await api.patch('/auth/me/', v); await reload(); toast(t('Profil saqlandi')) } catch (err) { toast(errorText(err), true) } finally { setBusy(false) }
  }
  const upload = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('avatar', file)
    try { await api.patch('/auth/me/', fd); await reload(); toast(t('Rasm yuklandi')) } catch (err) { toast(errorText(err), true) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const removeAvatar = async () => {
    try { await api.patch('/auth/me/', { remove_avatar: true }); await reload(); toast(t("Rasm o'chirildi")) } catch (err) { toast(errorText(err), true) }
  }
  const changePw = async (e) => {
    e.preventDefault()
    if (pw.new_password !== pw.confirm) { toast(t('Yangi parollar mos emas'), true); return }
    try {
      await api.post('/auth/me/password/', { old_password: pw.old_password, new_password: pw.new_password })
      setPw({ old_password: '', new_password: '', confirm: '' })
      toast(t("Parol o'zgartirildi"))
    } catch (err) { toast(errorText(err), true) }
  }

  return (
    <>
      <div className="page-head"><div><h1>{t('Mening profilim')}</h1><div className="page-sub">{t("Shaxsiy ma'lumotlar, rasm va parol")}</div></div></div>
      <div className="profile-grid">
        <div className="card profile-card">
          <div className="profile-avatar"><Avatar user={user} size={112} /></div>
          <div className="bold" style={{ fontSize: 17 }}>{user.full_name}</div>
          <div className="muted small">{user.username}{user.is_owner ? ` · ${t('Kompaniya egasi')}` : user.role_name ? ` · ${user.role_name}` : ''}</div>
          <div className="profile-actions">
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>{user.avatar_url ? t("Rasmni almashtirish") : t('Rasm yuklash')}</button>
            {user.avatar_url && <button type="button" className="btn small danger-ghost" onClick={removeAvatar}>{t("O'chirish")}</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files[0])} />
          </div>
          <div className="muted small">{t('JPG yoki PNG, 3 MB gacha')}</div>
        </div>
        <div>
          <form className="card" onSubmit={save}>
            <h2>{t("Shaxsiy ma'lumotlar")}</h2>
            <div className="form">
              <Field label={t('Ism familiya')}><input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required /></Field>
              <Field label={t('Login')}><input value={user.username} disabled /></Field>
              <Field label={t('Telefon')}><input value={v.phone} placeholder="+998 90 000 00 00" onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
              <Field label={t('Email')}><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            </div>
            <div className="form-actions"><button className="btn primary" disabled={busy}>{t('Saqlash')}</button></div>
          </form>
          <form className="card" onSubmit={changePw}>
            <h2>{t("Parolni o'zgartirish")}</h2>
            <div className="form">
              <Field label={t('Joriy parol')}><input type="password" value={pw.old_password} onChange={(e) => setPw({ ...pw, old_password: e.target.value })} required autoComplete="current-password" /></Field>
              <Field label={t('Yangi parol (kamida 8 belgi)')}><input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
              <Field label={t('Yangi parolni takrorlang')}><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" /></Field>
            </div>
            <div className="form-actions"><button className="btn primary">{t("Parolni o'zgartirish")}</button></div>
          </form>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------ foydalanuvchini tahrirlash (admin) */
export function UserModal({ user: u, roles, branches, onClose, onSaved }) {
  const { user: me } = useAuth()
  const [v, setV] = useState({
    full_name: u.employee?.full_name || u.full_name || '', phone: u.phone || '', email: u.email || '',
    role: u.role || '', branches: u.branches || [], is_active: u.is_active,
  })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const toggleBranch = (id) => setV((x) => ({ ...x, branches: x.branches.includes(id) ? x.branches.filter((b) => b !== id) : [...x.branches, id] }))
  const locked = u.is_owner
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const [first, ...rest] = v.full_name.trim().split(' ')
      const body = { first_name: first || '', last_name: rest.join(' '), phone: v.phone, email: v.email, branches: v.branches }
      if (!locked) { body.role = v.role || null; if (u.id !== me.id) body.is_active = v.is_active }
      await api.patch(`/auth/users/${u.id}/`, body)
      if (u.employee && v.full_name.trim() !== u.employee.full_name) await api.patch(`/hr/employees/${u.employee.id}/`, { full_name: v.full_name.trim() })
      if (password) await api.post(`/auth/users/${u.id}/set_password/`, { password })
      onSaved()
    } catch (err) { toast(errorText(err), true) } finally { setBusy(false) }
  }
  return (
    <Modal dialog title={t('Foydalanuvchi')} onClose={onClose}>
      <div className="user-head">
        <Avatar user={u} size={52} />
        <div>
          <div className="bold" style={{ fontSize: 16 }}>{u.employee?.full_name || u.full_name}</div>
          <div className="muted small">{u.username} · {t('oxirgi kirish')}: {u.last_login ? date(u.last_login) : t('hech qachon')}</div>
        </div>
        <span className="grow" />
        {u.is_owner ? <Badge kind="near_min">{t('egasi')}</Badge> : <Badge kind={u.is_active ? 'ok' : 'low'}>{u.is_active ? t('Faol') : t('Bloklangan')}</Badge>}
      </div>
      <form className="form" onSubmit={save}>
        <Field label={t('Ism familiya')}><input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} required /></Field>
        <Field label={t('Rol')}>
          {locked ? <input value={t('Barcha huquqlar (egasi)')} disabled /> : (
            <select value={v.role || ''} onChange={(e) => setV({ ...v, role: e.target.value })}>
              <option value="">{t('— rolsiz —')}</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </Field>
        <Field label={t('Telefon')}><input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label={t('Email')}><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label={t("Yangi parol (o'zgartirmasangiz bo'sh qoldiring)")} full>
          <input type="password" value={password} minLength={8} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {branches.length > 1 && (
          <div className="full">
            <div className="small muted" style={{ marginBottom: 6 }}>{t('Ruxsat etilgan filiallar (hech biri belgilanmasa — barcha filiallar)')}</div>
            <div className="filters">
              {branches.map((b) => (
                <button key={b.id} type="button" className={'chip' + (v.branches.includes(b.id) ? ' on' : '')} onClick={() => toggleBranch(b.id)}>{b.name}</button>
              ))}
            </div>
          </div>
        )}
        {!locked && u.id !== me.id && (
          <div className="full">
            <label className="check"><input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> {t("Faol (o'chirilsa — tizimga kira olmaydi)")}</label>
          </div>
        )}
        <div className="full form-actions">
          <button type="button" className="btn" onClick={onClose}>{t('Bekor')}</button>
          <button className="btn primary" disabled={busy}>{t('Saqlash')}</button>
        </div>
      </form>
    </Modal>
  )
}

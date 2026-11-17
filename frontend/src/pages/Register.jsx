import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorText } from '../api'
import { useAuth } from '../auth'
import { Field } from '../components/ui'
import { AuthHero } from './Login'
import { t } from '../i18n'

export default function Register() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [v, setV] = useState({ company_name: '', full_name: '', phone: '', email: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (v.password !== v.confirm) return setError('Parollar mos emas')
    setBusy(true)
    setError(null)
    try {
      const payload = { ...v }
      delete payload.confirm
      await api.post('/auth/register/', payload)
      await login(v.username, v.password)
      nav('/', { replace: true })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <AuthHero />
      <div className="side">
        <form className="box" onSubmit={submit} style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 24 }}>{t("Kompaniyani ro'yxatdan o'tkazish")}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{t("14 kun bepul. Karta talab qilinmaydi.")}</p>
          {error && <div className="error">{error}</div>}
          <div className="form" style={{ marginTop: 14 }}>
            <Field label={t("Kompaniya nomi")} full><input value={v.company_name} onChange={set('company_name')} required autoFocus /></Field>
            <Field label={t("Ismingiz (F.I.Sh.)")}><input value={v.full_name} onChange={set('full_name')} required /></Field>
            <Field label={t("Telefon")}><input value={v.phone} onChange={set('phone')} placeholder="+998 __ ___ __ __" required /></Field>
            <Field label={t("Email (ixtiyoriy)")} full><input type="email" value={v.email} onChange={set('email')} /></Field>
            <Field label={t("Login")} full><input value={v.username} onChange={set('username')} required autoComplete="username" /></Field>
            <Field label={t("Parol (kamida 8 belgi)")}><input type="password" value={v.password} onChange={set('password')} required autoComplete="new-password" /></Field>
            <Field label={t("Parolni takrorlang")}><input type="password" value={v.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
          </div>
          <button className="btn primary big" style={{ width: '100%', marginTop: 20 }} disabled={busy}>
            {busy ? 'Yaratilmoqda…' : "Ro'yxatdan o'tish va boshlash"}
          </button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>
            Akkauntingiz bormi? <Link to="/login">{t("Kirish")}</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

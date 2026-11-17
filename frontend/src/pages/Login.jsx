import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorText } from '../api'
import { useAuth } from '../auth'
import { t } from '../i18n'

export function AuthHero() {
  return (
    <div className="hero">
      <div style={{ fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="sb-logo">A</span> Akfa ERP
      </div>
      <div>
        <h1>{t("Buyurtmadan tannarxgacha — bitta tizimda")}</h1>
        <p>{t("Buyurtma, savdo, ishlab chiqarish, ombor, moliya va KPI. Qarzdorlik so'm va USD'da alohida.")}</p>
        <ul>
          <li>{t("Bir nechta filial va rollar bo'yicha huquqlar")}</li>
          <li>{t("Har bir buyurtma tannarxi va foydasi")}</li>
          <li>{t("14 kun bepul sinov")}</li>
        </ul>
      </div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{t("© Akfa ERP")}</div>
    </div>
  )
}

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
      nav('/', { replace: true })
    } catch (err) {
      setError(err?.response?.status === 401 ? "Login yoki parol noto'g'ri" : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <AuthHero />
      <div className="side">
        <form className="box" onSubmit={submit}>
          <h1 style={{ fontSize: 24 }}>{t("Tizimga kirish")}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{t("Login va parolingizni kiriting")}</p>
          {error && <div className="error">{error}</div>}
          <div className="field" style={{ marginTop: 16 }}>
            <label>{t("Login")}</label>
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("login")} autoComplete="username" />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("Parol")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button className="btn primary big" style={{ width: '100%', marginTop: 20 }} disabled={busy || !username || !password}>
            {busy ? 'Kirilmoqda…' : 'Kirish'}
          </button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 18 }}>
            Kompaniyangiz hali ro'yxatdan o'tmaganmi? <Link to="/register">{t("14 kun bepul sinab ko'ring")}</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { can, useAuth } from './auth'
import Layout, { NAV } from './components/Layout'
import { Loading } from './components/ui'
import { date } from './format'
import Login from './pages/Login'
import Register from './pages/Register'
import { t } from './i18n'

// Sahifalar alohida bo'laklarda (code-splitting) — faqat ochilganda yuklanadi
const OrdersPage = lazy(() => import('./pages/orders/OrdersPage'))
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'))
const SalesPage = lazy(() => import('./pages/sales/SalesPage'))
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'))
const ProductionPage = lazy(() => import('./pages/production/ProductionPage'))
const PurchasesPage = lazy(() => import('./pages/purchases/PurchasesPage'))
const ProductionDashboardPage = lazy(() => import('./pages/production/ProductionDashboardPage'))
const WarehousePage = lazy(() => import('./pages/warehouse/WarehousePage'))
const FinancePage = lazy(() => import('./pages/finance/FinancePage'))
const HrPage = lazy(() => import('./pages/hr/HrPage'))
const ProfilePage = lazy(() => import('./pages/settings/ProfilePage'))
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'))
const CounterpartiesPage = lazy(() => import('./pages/counterparties/CounterpartiesPage'))
const CounterpartyPage = lazy(() => import('./pages/counterparties/CounterpartyPage'))
const CompanyPage = lazy(() => import('./pages/company/CompanyPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))
const PlatformPage = lazy(() => import('./pages/platform/PlatformPage'))

/** Foydalanuvchi ko'ra oladigan birinchi bo'lim */
function home(user) {
  const preferred = ['/orders', '/sales', '/purchases', '/production', '/warehouse', '/finance']
  const all = NAV.flatMap((g) => g.items)
  const first = preferred.map((p) => all.find((i) => i.to === p)).find((i) => i && can(user, i.module))
    || all.find((i) => can(user, i.module))
  return first ? first.to : '/no-access'
}

function NoAccess() {
  return <div className="card empty">{t("Sizga hech bir bo'limga huquq berilmagan. Administratorga murojaat qiling.")}</div>
}

function Expired() {
  const { user, logout } = useAuth()
  const c = user.company
  return (
    <div className="lock-screen">
      <div className="card">
        <div style={{ fontSize: 40 }}>⏳</div>
        <h1 style={{ margin: '8px 0' }}>{c.status === 'blocked' ? 'Kompaniya bloklangan' : 'Obuna muddati tugagan'}</h1>
        <p className="muted">
          <b>{c.name}</b> — {c.status === 'trial' ? 'sinov muddati' : 'obuna'} {c.access_until ? `${date(c.access_until)} da tugagan.` : 'faol emas.'}
          <br />Tizimdan foydalanishni davom ettirish uchun platforma administratori bilan bog'laning. Ma'lumotlaringiz saqlanib qoladi.
        </p>
        <button className="btn" onClick={logout}>{t("Chiqish")}</button>
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  if (user.is_platform_admin) {
    return (
      <Routes>
        <Route element={<Layout platform />}>
          <Route path="/platform" element={<PlatformPage />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Route>
      </Routes>
    )
  }
  if (!user.company) return <div className="lock-screen"><div className="card">{t("Foydalanuvchi kompaniyaga biriktirilmagan.")}</div></div>
  if (!user.company.is_accessible) return <Expired />

  const guard = (module, el) => (can(user, module) ? el : <Navigate to={home(user)} replace />)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={guard('dashboard', <DashboardPage />)} />
        <Route path="/orders" element={guard('orders', <OrdersPage />)} />
        <Route path="/orders/:id" element={guard('orders', <OrderDetail />)} />
        <Route path="/sales/:tab?" element={guard('sales', <SalesPage />)} />
        <Route path="/purchases/:tab?" element={guard(['purchase_orders', 'supplies', 'purchase_returns'], <PurchasesPage />)} />
        <Route path="/products" element={guard('products', <ProductsPage />)} />
        <Route path="/production-dashboard" element={guard('production', <ProductionDashboardPage />)} />
        <Route path="/production" element={guard('production', <ProductionPage />)} />
        <Route path="/warehouse/:tab?" element={guard(['warehouse', 'stock_enter', 'stock_loss', 'stock_move', 'stock_inventory'], <WarehousePage />)} />
        <Route path="/finance" element={guard('finance', <FinancePage />)} />
        <Route path="/hr" element={guard('hr', <HrPage />)} />
        <Route path="/counterparties" element={guard('counterparties', <CounterpartiesPage />)} />
        <Route path="/counterparties/:id" element={guard('counterparties', <CounterpartyPage />)} />
        <Route path="/company" element={guard('company', <CompanyPage />)} />
        <Route path="/settings" element={guard('settings', <SettingsPage />)} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="*" element={<Navigate to={home(user)} replace />} />
      </Route>
    </Routes>
  )
}

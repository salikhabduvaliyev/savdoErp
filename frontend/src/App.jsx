import { Navigate, Route, Routes } from 'react-router-dom'
import { can, useAuth } from './auth'
import Layout, { NAV } from './components/Layout'
import { Loading } from './components/ui'
import { date } from './format'
import Login from './pages/Login'
import Register from './pages/Register'
import OrdersPage from './pages/orders/OrdersPage'
import OrderDetail from './pages/orders/OrderDetail'
import SalesPage from './pages/sales/SalesPage'
import ProductsPage from './pages/products/ProductsPage'
import ProductionPage from './pages/production/ProductionPage'
import PurchasesPage from './pages/purchases/PurchasesPage'
import ProductionDashboardPage from './pages/production/ProductionDashboardPage'
import WarehousePage from './pages/warehouse/WarehousePage'
import FinancePage from './pages/finance/FinancePage'
import HrPage from './pages/hr/HrPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import CounterpartiesPage from './pages/counterparties/CounterpartiesPage'
import CounterpartyPage from './pages/counterparties/CounterpartyPage'
import CompanyPage from './pages/company/CompanyPage'
import SettingsPage from './pages/settings/SettingsPage'
import PlatformPage from './pages/platform/PlatformPage'
import { t } from './i18n'

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
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="*" element={<Navigate to={home(user)} replace />} />
      </Route>
    </Routes>
  )
}

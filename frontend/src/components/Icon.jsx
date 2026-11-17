// Zamonaviy chiziqli ikonlar (lucide). Nom bo'yicha: <Icon name="edit" />
import {
  ArrowLeft, BadgeDollarSign, BookOpen, Building2, Check, ChevronLeft, ChevronRight, Copy, Download, Eye, Factory,
  Filter, Gauge, KeyRound, LayoutDashboard, LockKeyhole, LogOut, MapPin, Menu, MoreHorizontal, Package, PanelLeft, Pencil,
  Plus, Printer, ReceiptText, RefreshCw, Save, Search, Server, Settings, ShieldCheck, ShoppingCart, SlidersHorizontal,
  Trash2, TrendingUp, Upload, User, Users, Wallet, Warehouse, X,
} from 'lucide-react'
import { t } from '../i18n'

const ICONS = {
  // bo'limlar
  dashboard: LayoutDashboard,
  'production-dashboard': Gauge,
  orders: ReceiptText,
  sales: ShoppingCart,
  products: Package,
  production: Factory,
  warehouse: Warehouse,
  finance: Wallet,
  hr: TrendingUp,
  counterparties: Users,
  company: Building2,
  settings: Settings,
  platform: Server,
  // umumiy
  branch: MapPin,
  menu: Menu,
  sidebar: PanelLeft,
  logout: LogOut,
  key: KeyRound,
  lock: LockKeyhole,
  user: User,
  roles: ShieldCheck,
  sliders: SlidersHorizontal,
  currency: BadgeDollarSign,
  book: BookOpen,
  chevron: ChevronLeft,
  'chevron-right': ChevronRight,
  back: ArrowLeft,
  plus: Plus,
  check: Check,
  edit: Pencil,
  delete: Trash2,
  close: X,
  save: Save,
  copy: Copy,
  view: Eye,
  print: Printer,
  search: Search,
  filter: Filter,
  refresh: RefreshCw,
  more: MoreHorizontal,
  download: Download,
  upload: Upload,
}

export default function Icon({ name, size = 18, strokeWidth = 1.9, className }) {
  const C = ICONS[name]
  if (!C) return null
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />
}

/** Faqat ikonli tugma: matn tooltip (title) sifatida chiqadi. */
export function IconBtn({ icon, title, onClick, danger, disabled, type = 'button', size = 16 }) {
  return (
    <button type={type} className={'icon-act' + (danger ? ' danger' : '')} onClick={onClick} title={t(title)} aria-label={t(title)} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  )
}

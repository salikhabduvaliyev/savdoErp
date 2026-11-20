from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.tenancy import TenantModel

# Tizim bo'limlari (modullar) — guruhlar bo'yicha (rol sozlamalari jadvali shu tartibda).
# Huquqlar MoySklad uslubida: bo'lim (chapdagi ro'yxat) → hujjat turlari (jadval qatorlari).
MODULE_GROUPS = [
    ("Asosiy", [("dashboard", "Dashboard")]),
    ("Savdo", [("orders", "Buyurtmalar"), ("sales", "Sotuvlar"), ("sales_returns", "Mijoz qaytarishlari")]),
    ("Xaridlar", [("purchase_orders", "Yetkazuvchiga buyurtmalar"), ("supplies", "Qabul qilish"),
                  ("purchase_returns", "Yetkazuvchiga qaytarish")]),
    ("Ombor", [("stock_enter", "Kirimlar"), ("stock_loss", "Hisobdan chiqarish"), ("stock_move", "Ko'chirish"),
               ("stock_inventory", "Inventarizatsiya"), ("warehouse", "Qoldiqlar, aylanma, omborlar")]),
    ("Tovarlar", [("products", "Tovarlar va xizmatlar")]),
    ("CRM", [("counterparties", "Kontragentlar")]),
    ("Ishlab chiqarish", [("production", "Ishlab chiqarish")]),
    ("Pul", [("finance", "To'lovlar va moliya hisobotlari")]),
    ("Xodimlar", [("hr", "KPI va oylik")]),
    ("Kompaniya", [("company", "Kompaniya ma'lumotlari")]),
    ("Sozlamalar", [("settings", "Sozlamalar")]),
]
MODULES = [m for _, items in MODULE_GROUPS for m in items]
MODULE_KEYS = [k for k, _ in MODULES]
ACTIONS = ["view", "create", "edit", "delete", "post"]
# "Ko'radi: o'zinikini" qo'llanadigan modullar (hujjatda mas'ul/yaratuvchi bor)
SCOPED_MODULES = ["orders", "sales"]
# "O'tkazish" (Проводить) amali bor hujjatlar
POSTABLE_MODULES = ["sales", "sales_returns", "purchase_orders", "supplies", "purchase_returns",
                    "stock_enter", "stock_loss", "stock_move", "stock_inventory"]
# eski modul → yangi hujjat turlari (eski rollar va boshlang'ich rollar uchun)
ALIASES = {
    "purchases": ["purchase_orders", "supplies", "purchase_returns"],
    "warehouse": ["warehouse", "stock_enter", "stock_loss", "stock_move", "stock_inventory"],
    "sales": ["sales", "sales_returns"],
}


def perm(view=False, create=False, edit=False, delete=False, scope="all", post=None):
    return {"view": view, "create": create, "edit": edit, "delete": delete, "scope": scope,
            "post": edit if post is None else post}


FULL = perm(True, True, True, True)
VIEW = perm(True)
NONE = perm()
WORK = perm(True, True, True, False)  # o'chirmasdan ishlash


def _perms(**kw):
    for old, new in ALIASES.items():
        if old in kw:
            for k in new:
                kw.setdefault(k, kw[old])
    return {m: dict(kw.get(m, NONE)) for m in MODULE_KEYS}


# Yangi kompaniyaga yaratiladigan boshlang'ich rollar (keyin xohlagancha o'zgartiriladi).
DEFAULT_ROLES = [
    ("admin", "Administrator", "Hamma bo'limlarga to'liq kirish", _perms(**{m: FULL for m in MODULE_KEYS}), False),
    ("director", "Direktor", "Hamma bo'limlar", _perms(**{m: FULL for m in MODULE_KEYS}), False),
    ("manager", "Menejer", "Savdo va buyurtmalar, boshqalarni ko'rish",
     _perms(dashboard=VIEW, orders=WORK, sales=WORK, counterparties=WORK, production=VIEW, warehouse=VIEW,
            products=VIEW, finance=VIEW, company=VIEW), False),
    ("operator", "Sotuv operatori", "Faqat o'z buyurtma va sotuvlari",
     _perms(orders=perm(True, True, True, False, "own"), sales=perm(True, True, True, False, "own"),
            counterparties=WORK, products=VIEW, warehouse=VIEW), False),
    ("production_manager", "Ishlab chiqarish menejeri", "Ishlab chiqarish va ombor",
     _perms(dashboard=VIEW, orders=WORK, production=FULL, warehouse=FULL, purchases=WORK, products=WORK, counterparties=VIEW, company=VIEW), False),
    ("dept_head", "Bo'lim boshlig'i", "Faqat o'z bo'limi topshiriqlari", _perms(production=WORK), True),
    ("storekeeper", "Omborchi", "Ombor harakatlari",
     _perms(warehouse=WORK, purchases=WORK, products=WORK, production=VIEW, orders=VIEW, sales=VIEW, counterparties=VIEW), False),
    ("accountant", "Hisobchi", "Moliya, oylik, KPI",
     _perms(dashboard=VIEW, orders=VIEW, sales=VIEW, purchases=VIEW, finance=FULL, hr=FULL, counterparties=WORK, company=VIEW), False),
    ("cashier", "Kassir", "Sotuv va to'lov qabul qilish",
     _perms(sales=WORK, counterparties=WORK, products=VIEW, finance=perm(True, True, False, False)), False),
]


def normalize_permissions(value):
    """Har qanday (eski yoki to'liq bo'lmagan) qiymatni to'liq tuzilmaga keltiradi."""
    out = {}
    value = value or {}
    for m in MODULE_KEYS:
        v = value.get(m)
        if isinstance(v, str):  # eski format: none/view/edit
            v = {"none": NONE, "view": VIEW, "edit": WORK}.get(v, NONE)
        if v is None:  # yangi kalit (masalan stock_loss) — eski moduldan meros
            for old, new in ALIASES.items():
                if m in new and old != m and isinstance(value.get(old), dict):
                    v = value[old]
                    break
        had_post = isinstance(v, dict) and "post" in v
        v = dict(NONE, **(v or {}))
        if not had_post:
            v["post"] = bool(v.get("edit"))
        if not v["view"]:  # ko'rmasa, boshqa amal ham yo'q
            v.update(create=False, edit=False, delete=False, post=False)
        if v.get("scope") not in ("all", "own"):
            v["scope"] = "all"
        out[m] = {k: (bool(v[k]) if k != "scope" else v[k]) for k in ACTIONS + ["scope"]}
    return out


class Role(TenantModel):
    code = models.SlugField(max_length=40)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    permissions = models.JSONField(default=dict, help_text="{modul: {view, create, edit, delete, scope}}")
    own_department_only = models.BooleanField(
        default=False, help_text="Ishlab chiqarishda faqat o'z bo'limi topshiriqlarini ko'radi"
    )
    is_system = models.BooleanField(default=False, help_text="Tizim roli — o'chirib bo'lmaydi")

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_role_code"),
            models.UniqueConstraint(fields=["company", "name"], name="uniq_role_name"),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.permissions = normalize_permissions(self.permissions)
        super().save(*args, **kwargs)


class User(AbstractUser):
    """Foydalanuvchi. company=None — platforma admini (superuser)."""

    company = models.ForeignKey("core.Company", null=True, blank=True, on_delete=models.CASCADE, related_name="users")
    role = models.ForeignKey(Role, null=True, blank=True, on_delete=models.PROTECT, related_name="users")
    is_owner = models.BooleanField(default=False, help_text="Kompaniya egasi (ro'yxatdan o'tgan) — barcha huquqlar")
    branches = models.ManyToManyField("core.Branch", blank=True, related_name="users",
                                      help_text="Ruxsat etilgan filiallar (bo'sh — hammasi)")
    department = models.ForeignKey(
        "production.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="users"
    )
    phone = models.CharField(max_length=32, blank=True)
    avatar = models.FileField(upload_to="avatars/", null=True, blank=True, help_text="Profil rasmi")
    password_vault = models.TextField(blank=True, editable=False,
                                      help_text="Joriy parol, shifrlangan (platforma admini ko'radi) — accounts/vault.py")
    preferences = models.JSONField(default=dict, blank=True, help_text="Mavzu, til, jadval ustunlari...")

    def set_password(self, raw_password):
        super().set_password(raw_password)
        from .vault import seal

        self.password_vault = seal(raw_password) if raw_password else ""

    @property
    def full_name(self):
        emp = getattr(self, "employee", None)
        if emp:
            return emp.full_name
        return self.get_full_name() or self.username

    @property
    def role_code(self):
        return self.role.code if self.role_id else None

    @property
    def is_platform_admin(self):
        return self.is_superuser and not self.company_id

    def _perm(self, module):
        if self.is_owner:
            return FULL
        if not self.role_id:
            return NONE
        return normalize_permissions(self.role.permissions)[module]

    def can(self, module, action="view"):
        if not self.company_id:
            return False
        return bool(self._perm(module).get(action))

    def can_view(self, module):
        return self.can(module, "view")

    def can_edit(self, module):
        return self.can(module, "edit")

    def scope(self, module):
        return self._perm(module).get("scope", "all")

    @property
    def permissions_map(self):
        return {m: dict(self._perm(m)) for m in MODULE_KEYS}

    @property
    def own_department_only(self):
        return bool(self.role_id and self.role.own_department_only and not self.is_owner)

    def allowed_branch_ids(self):
        """None — cheklovsiz (hamma filial)."""
        ids = list(self.branches.values_list("id", flat=True))
        return ids or None

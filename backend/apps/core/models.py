from datetime import timedelta
from decimal import Decimal

from django.db import models
from django.utils import timezone

from .tenancy import TenantManager, TenantModel, current_company_id


class Currency(models.TextChoices):
    UZS = "UZS", "so'm"
    USD = "USD", "USD"


def money_field(**kwargs):
    """Pul summasi — hech qachon float emas."""
    kwargs.setdefault("max_digits", 18)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("default", Decimal("0"))
    return models.DecimalField(**kwargs)


def qty_field(**kwargs):
    kwargs.setdefault("max_digits", 14)
    kwargs.setdefault("decimal_places", 3)
    kwargs.setdefault("default", Decimal("0"))
    return models.DecimalField(**kwargs)


BASE_CURRENCY = "UZS"


def validate_currency(code):
    """Valyuta kompaniya ma'lumotnomasida bo'lishi kerak (UZS va USD doim ruxsat)."""
    from django.core.exceptions import ValidationError

    if code in Currency.values:
        return
    if current_company_id() is None:
        return
    if not CurrencyDef.objects.filter(code=code, is_active=True).exists():
        raise ValidationError(f"Valyuta topilmadi: {code} (Sozlamalar → Valyutalar)")


def currency_field(**kwargs):
    kwargs.setdefault("max_length", 3)
    kwargs.setdefault("default", Currency.UZS)
    kwargs.setdefault("validators", [validate_currency])
    return models.CharField(**kwargs)


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# ---------------------------------------------------------------- tenant

class Company(models.Model):
    """Mijoz-kompaniya (SaaS tenant): rekvizitlar + obuna."""

    class Status(models.TextChoices):
        TRIAL = "trial", "Sinov muddati"
        ACTIVE = "active", "Faol (to'langan)"
        BLOCKED = "blocked", "Bloklangan"

    TRIAL_DAYS = 14

    name = models.CharField("Qisqa nomi", max_length=200)
    legal_name = models.CharField("Yuridik nomi", max_length=300, blank=True)
    inn = models.CharField("STIR", max_length=20, blank=True)
    oked = models.CharField("OKED", max_length=20, blank=True)
    vat_code = models.CharField("QQS kodi", max_length=30, blank=True)
    director = models.CharField("Rahbar", max_length=200, blank=True)
    accountant = models.CharField("Bosh hisobchi", max_length=200, blank=True)
    address = models.CharField("Yuridik manzil", max_length=300, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    website = models.CharField(max_length=200, blank=True)
    bank_name = models.CharField("Bank", max_length=200, blank=True)
    bank_mfo = models.CharField("MFO", max_length=10, blank=True)
    bank_account = models.CharField("Hisob raqam", max_length=30, blank=True)
    logo = models.FileField(upload_to="company/", null=True, blank=True)

    # obuna
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.TRIAL)
    trial_ends = models.DateField(null=True, blank=True)
    paid_until = models.DateField(null=True, blank=True)
    max_users = models.PositiveIntegerField(default=0, help_text="0 — cheklanmagan")
    platform_note = models.TextField(blank=True, help_text="Platforma admini izohi")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.trial_ends and not self.pk:
            self.trial_ends = timezone.localdate() + timedelta(days=self.TRIAL_DAYS)
        super().save(*args, **kwargs)

    @property
    def access_until(self):
        if self.status == self.Status.ACTIVE:
            return self.paid_until
        if self.status == self.Status.TRIAL:
            return self.trial_ends
        return None

    @property
    def is_accessible(self):
        until = self.access_until
        return self.status != self.Status.BLOCKED and until is not None and until >= timezone.localdate()

    @property
    def days_left(self):
        until = self.access_until
        return (until - timezone.localdate()).days if until else 0


class Branch(TenantModel):
    """Filial."""

    name = models.CharField(max_length=150)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    is_main = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-is_main", "name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_branch_name")]

    def __str__(self):
        return self.name


class CurrencyDef(TenantModel):
    """Valyutalar ma'lumotnomasi (MoySklad: "Валюты"). Asosiy valyuta — so'm (UZS).

    Kurs qo'lda kiritiladi yoki CBU'dan avtomatik olinadi (auto_update).
    """

    code = models.CharField(max_length=3, help_text="ISO kod: USD, EUR, RUB…")
    name = models.CharField(max_length=60)
    symbol = models.CharField(max_length=8, blank=True)
    is_base = models.BooleanField(default=False)
    auto_update = models.BooleanField(default=True, help_text="Kursni CBU'dan avtomatik olish")
    is_active = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-is_base", "position", "code"]
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="uniq_currency_code")]

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        self.code = self.code.upper()
        super().save(*args, **kwargs)


class ExchangeRate(TenantModel):
    """Valyuta kursi sanalar bo'yicha: 1 birlik = rate so'm (har kompaniya o'zi yuritadi).

    Qoida: operatsiya sanasidagi (yoki undan oldingi eng yaqin) kurs ishlatiladi.
    `usd_uzs` — tarixiy nom, aslida "1 birlik valyuta necha so'm".
    """

    currency = models.CharField(max_length=3, default="USD")
    date = models.DateField()
    usd_uzs = models.DecimalField(max_digits=14, decimal_places=4)
    source = models.CharField(max_length=50, blank=True, default="CBU")

    class Meta:
        ordering = ["-date", "currency"]
        constraints = [models.UniqueConstraint(fields=["company", "currency", "date"], name="uniq_rate_cur_date")]

    def __str__(self):
        return f"{self.date}: 1 {self.currency} = {self.usd_uzs} so'm"

    @staticmethod
    def _drop_cache():
        from .money import _rate_cache

        cache = _rate_cache.get()
        if cache is not None:
            cache.clear()

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self._drop_cache()

    def delete(self, *args, **kwargs):
        res = super().delete(*args, **kwargs)
        self._drop_cache()
        return res


class SystemSettings(TenantModel):
    """Kompaniyaning umumiy sozlamalari — biznes qoidalari kodda emas, shu yerda."""

    default_currency = currency_field()
    order_number_start = models.PositiveIntegerField(default=3200, help_text="Birinchi buyurtma raqami (shundan keyingi)")
    sale_number_start = models.PositiveIntegerField(default=1000, help_text="Birinchi sotuv raqami (shundan keyingi)")
    stock_near_min_ratio = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("1.20"),
                                               help_text="Mavjud ≤ minimal × shu koeffitsiyent → 'Minimalga yaqin'")
    daily_capacity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("40"),
                                         help_text="Kalendar: kunlik sig'im, m²")
    defect_norm_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("3"), help_text="Brak me'yori, %")
    working_days = models.PositiveSmallIntegerField(default=22, help_text="Oydagi ish kunlari normasi (tabel)")
    kanban_delivered_days = models.PositiveSmallIntegerField(default=14, help_text="Kanbanda topshirilganlar necha kun ko'rinadi")
    allow_negative_stock = models.BooleanField(default=False, help_text="Sotuvda qoldiqdan ko'p sotishga ruxsat")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company"], name="uniq_settings_company")]

    @classmethod
    def load(cls):
        cid = current_company_id()
        if not cid:
            return cls()  # kontekstsiz — standart qiymatlar
        obj = cls.objects.filter(company_id=cid).first()
        return obj or cls.objects.create(company_id=cid)


class CustomField(TenantModel):
    """Qo'shimcha maydon (MoySklad "Дополнительные поля"): buyurtma, kontragent, sotuv uchun."""

    class Entity(models.TextChoices):
        ORDER = "order", "Buyurtma"
        COUNTERPARTY = "counterparty", "Kontragent"
        SALE = "sale", "Sotuv"

    class Type(models.TextChoices):
        TEXT = "text", "Matn"
        NUMBER = "number", "Son"
        DATE = "date", "Sana"
        BOOL = "bool", "Ha/Yo'q"
        SELECT = "select", "Ro'yxatdan tanlash"
        USER = "user", "Xodim"

    entity = models.CharField(max_length=20, choices=Entity.choices)
    key = models.SlugField(max_length=50)
    name = models.CharField(max_length=100)
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.TEXT)
    options = models.JSONField(default=list, blank=True, help_text="Tanlash uchun variantlar")
    required = models.BooleanField(default=False)
    show_in_list = models.BooleanField(default=True, help_text="Ro'yxatda ustun sifatida")
    filterable = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["entity", "position", "id"]
        constraints = [models.UniqueConstraint(fields=["company", "entity", "key"], name="uniq_custom_field_key")]

    def __str__(self):
        return f"{self.get_entity_display()}: {self.name}"


__all__ = ["CustomField", 
    "Currency", "money_field", "qty_field", "currency_field", "TimeStamped", "Company", "Branch",
    "ExchangeRate", "SystemSettings", "TenantModel", "TenantManager",
]


class AuditLog(TenantModel):
    """Kompaniya tarixi: kim, qachon, nimani yaratdi / o'zgartirdi / o'chirdi."""

    class Action(models.TextChoices):
        CREATE = "create", "Yaratildi"
        UPDATE = "update", "O'zgartirildi"
        DELETE = "delete", "O'chirildi"
        START = "start", "Ishga tushirildi"
        STATUS = "status", "Holat o'zgardi"

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=10, choices=Action.choices)
    entity = models.CharField(max_length=30, db_index=True)
    entity_id = models.PositiveBigIntegerField(null=True, blank=True)
    title = models.CharField(max_length=250)
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["company", "entity", "entity_id"])]

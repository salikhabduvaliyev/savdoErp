from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Max, Sum
from django.utils import timezone

from apps.core.models import Currency, TimeStamped, currency_field, money_field, qty_field
from apps.core.tenancy import TenantModel

ZERO = Decimal("0")


STATE_DEFAULTS = [
    ("new", "Yangi", "#2563eb"), ("confirmed", "Tasdiqlandi", "#0891b2"), ("in_production", "Ishlab chiqarishda", "#7c3aed"),
    ("ready", "Tayyor", "#d97706"), ("delivered", "Topshirildi", "#16a34a"), ("cancelled", "Bekor qilindi", "#dc2626"),
]


# Statusga avtomatik o'tish hodisalari: trigger → tizim turi (kind)
STATE_TRIGGERS = [
    ("sent_to_production", "Ishlab chiqarishga berilganda", "confirmed"),
    ("production_started", "Ish boshlanganda", "in_production"),
    ("department", "Bosqich shu bo'limga kelganda", "in_production"),
    ("production_done", "Ishlab chiqarish tugaganda", "ready"),
    ("sold", "Sotuv o'tkazilganda", "delivered"),
]
TRIGGER_KIND = {k: kind for k, _, kind in STATE_TRIGGERS}


class OrderState(TenantModel):
    """Buyurtma statusi (MoySklad: Настройки → Статусы). Kompaniya o'zi nomlaydi, rang beradi, qo'shadi va o'chiradi.

    `kind` — tizim mantig'i uchun turi (ishlab chiqarishga yuborilganda, sotuvda, bekor qilishda kerak).
    Bir turda bir nechta status bo'lishi mumkin (masalan, "Yangi" turida: "Qo'ng'iroq qilish", "O'lchov kutilmoqda").
    """

    name = models.CharField(max_length=60)
    color = models.CharField(max_length=20, default="#2563eb")
    kind = models.CharField(max_length=16, default="new")
    trigger = models.CharField(max_length=24, blank=True, default="",
                               help_text="Avtomatik o'tish: ishlab chiqarish / sotuv hodisasi (STATE_TRIGGERS)")
    department = models.ForeignKey("production.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                                   help_text="trigger=department bo'lsa — qaysi bo'lim")
    position = models.PositiveSmallIntegerField(default=0)

    def save(self, *args, **kwargs):
        if self.trigger in TRIGGER_KIND:
            self.kind = TRIGGER_KIND[self.trigger]  # tizim mantig'i buzilmasin
        if self.trigger != "department":
            self.department = None
        super().save(*args, **kwargs)

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_order_state_name")]

    def __str__(self):
        return self.name


def ensure_order_states():
    """Kompaniyada statuslar bo'lmasa — standart to'plam (keyin foydalanuvchi o'zgartiradi)."""
    if not OrderState.objects.exists():
        auto = {"confirmed": "sent_to_production", "in_production": "production_started", "ready": "production_done",
                "delivered": "sold"}
        for i, (kind, name, color) in enumerate(STATE_DEFAULTS):
            OrderState.objects.create(kind=kind, name=name, color=color, position=(i + 1) * 10, trigger=auto.get(kind, ""))


def apply_order_event(order, trigger, department_id=None):
    """Hodisa bo'yicha buyurtmani bog'langan statusga o'tkazish (bog'langan status bo'lmasa — o'zgarmaydi).
    Topshirilgan / bekor qilingan buyurtma ishlab chiqarish hodisalari bilan orqaga qaytmaydi."""
    if order.status == Order.Status.CANCELLED:
        return False
    if order.status == Order.Status.DELIVERED and trigger != "sold":
        return False
    qs = OrderState.objects.filter(trigger=trigger)
    if trigger == "department":
        qs = qs.filter(department_id=department_id)
    st = qs.order_by("position", "id").first()
    if st is None or order.state_id == st.id:
        return False
    order.state = st
    order.status = st.kind
    order.save()
    return True


def state_for_kind(kind):
    ensure_order_states()
    return OrderState.objects.filter(kind=kind).order_by("position", "id").first()


class Order(TenantModel, TimeStamped):
    """Buyurtma.

    Maketdagi muammo: ro'yxatda status ustunida "Kesish", "Montaj" (bo'lim nomlari)
    ko'rsatilgan, kanbanda esa boshqa statuslar. Yechim — ikki alohida tushuncha:
      * status — biznes-holat (kanban ustunlari);
      * stage  — hozir qaysi bo'limda (topshiriqlardan avtomatik hisoblanadi).

    Ikkinchi muammo: kalendar va ro'yxatda sanalar mos emas edi. Yechim:
      * plan_date       — mijozga topshirish muddati (ro'yxatdagi "Reja sana");
      * production_date — ishlab chiqarish kalendaridagi kun (kalendarda sudraladi).
    """

    class Status(models.TextChoices):
        NEW = "new", "Yangi"
        CONFIRMED = "confirmed", "Tasdiqlandi"
        IN_PRODUCTION = "in_production", "Ishlab chiqarishda"
        READY = "ready", "Tayyor"
        DELIVERED = "delivered", "Topshirildi"
        CANCELLED = "cancelled", "Bekor qilindi"

    CLOSED_STATUSES = (Status.DELIVERED, Status.CANCELLED)

    number = models.PositiveIntegerField(editable=False)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="orders")
    date = models.DateField(default=timezone.localdate)
    client = models.ForeignKey("crm.Counterparty", on_delete=models.PROTECT, related_name="orders")
    currency = currency_field()
    amount = money_field()
    volume = qty_field(help_text="Hajm, m² — kalendar yuklamasi uchun")
    reserve = models.BooleanField(default=False, help_text="Rezerv (MoySklad): tovar va materiallar shu buyurtma uchun band")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NEW)
    state = models.ForeignKey(OrderState, null=True, blank=True, on_delete=models.PROTECT, related_name="orders",
                              help_text="Foydalanuvchi statusi; turi (kind) = status")
    plan_date = models.DateField(help_text="Mijozga topshirish muddati")
    production_date = models.DateField(null=True, blank=True, help_text="Ishlab chiqarish kalendaridagi kun")
    delivered_at = models.DateField(null=True, blank=True)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="managed_orders")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="operated_orders")
    note = models.TextField(blank=True)
    extra = models.JSONField(default=dict, blank=True, help_text="Qo'shimcha maydonlar")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-number"]
        constraints = [models.UniqueConstraint(fields=["company", "number"], name="uniq_order_number")]

    def __str__(self):
        return f"#{self.number}"

    def save(self, *args, **kwargs):
        if not self.number:
            from apps.core.models import SystemSettings

            start = SystemSettings.load().order_number_start
            last = max(Order.objects.aggregate(m=Max("number"))["m"] or 0, start)
            self.number = last + 1
        if self.status == self.Status.DELIVERED and not self.delivered_at:
            self.delivered_at = timezone.localdate()
        # tizim statusi o'zgarsa (masalan, ishlab chiqarishga yuborildi) — shu turdagi birinchi foydalanuvchi statusi
        if self.state_id is None or self.state.kind != self.status:
            self.state = state_for_kind(self.status)
        super().save(*args, **kwargs)

    @property
    def state_name(self):
        return self.state.name if self.state_id else self.get_status_display()

    # --- to'lov va qarz (buyurtma valyutasida) ---
    @property
    def paid(self) -> Decimal:
        if hasattr(self, "_paid"):
            return self._paid or ZERO
        from apps.finance.models import Transaction

        return (
            Transaction.objects.filter(order=self, kind=Transaction.Kind.CLIENT_PAYMENT)
            .aggregate(s=Sum("order_amount"))["s"]
            or ZERO
        )

    @property
    def is_sold(self) -> bool:
        """Buyurtmadan yakunlangan sotuv qilinganmi (u holda qarz sotuv bo'yicha yuritiladi)."""
        if hasattr(self, "_sold"):
            return bool(self._sold)
        return self.sales.filter(status="completed").exists()

    @property
    def debt(self) -> Decimal:
        if self.status == self.Status.CANCELLED or self.is_sold:
            return ZERO
        return self.amount - self.paid

    # --- muddat ---
    @property
    def is_overdue(self) -> bool:
        return self.status not in self.CLOSED_STATUSES and self.plan_date < timezone.localdate()

    @property
    def overdue_days(self) -> int:
        """Yagona formula: bugun − reja sana (maketda 5 va 7 kun deb har xil edi)."""
        return (timezone.localdate() - self.plan_date).days if self.is_overdue else 0

    # --- ishlab chiqarish ---
    @property
    def stage(self):
        """Hozirgi bo'lim: tugamagan birinchi topshiriqning bo'limi."""
        open_tasks = [t for t in self.tasks.all() if t.status != "done"]  # prefetch bilan ishlaydi
        if not open_tasks:
            return None
        # texjarayondagi bosqich tartibi (position) bo'yicha — bo'lim raqami emas
        task = min(open_tasks, key=lambda t: (t.position, t.department.sequence, t.id))
        return task.department.name

    @property
    def progress(self) -> Decimal:
        tasks = list(self.tasks.all())
        if not tasks:
            return Decimal("1") if self.status in (self.Status.READY, self.Status.DELIVERED) else ZERO
        return sum((t.progress for t in tasks), ZERO) / len(tasks)

    def on_task_changed(self):
        """Topshiriqlar holatiga qarab statusni avtomatik siljitish (Sozlamalar → Statuslar: avtomatik o'tish)."""
        tasks = list(self.tasks.select_related("department").all())
        if not tasks or self.status in (self.Status.DELIVERED, self.Status.CANCELLED):
            return
        if all(t.status == "done" for t in tasks):
            if not apply_order_event(self, "production_done") and self.status in (self.Status.NEW, self.Status.CONFIRMED,
                                                                                  self.Status.IN_PRODUCTION):
                self.status = self.Status.READY
                self.save()
            return
        if not any(t.status in ("in_progress", "done", "paused") or t.done_qty > 0 for t in tasks):
            return
        # hozirgi bosqich bo'limi — shu bo'limga bog'langan status bo'lsa, o'shanga
        cur = min((t for t in tasks if t.status != "done"), key=lambda t: (t.position, t.department.sequence, t.id))
        if apply_order_event(self, "department", cur.department_id):
            return
        if OrderState.objects.filter(trigger="department", pk=self.state_id).exists():
            # oldingi bo'lim statusidan keyingi bosqichga bog'lanmagan bo'lsa — umumiy "ish boshlandi"
            if apply_order_event(self, "production_started"):
                return
        if self.status in (self.Status.NEW, self.Status.CONFIRMED):
            if not apply_order_event(self, "production_started"):
                self.status = self.Status.IN_PRODUCTION
                self.save()

    @property
    def active_estimate(self):
        return self.estimates.filter(is_active=True).order_by("-version").first()


class OrderFile(TenantModel):
    """Buyurtmaga biriktirilgan fayl (chizma, PDF, Word ...)."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="files")
    file = models.FileField(upload_to="orders/")
    name = models.CharField(max_length=255, blank=True)
    size = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.name or self.file.name


class OrderItem(TenantModel):
    """Buyurtma pozitsiyasi (MoySklad: "Позиции заказа") — tovar/xizmat/mahsulot, miqdor, narx, chegirma."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("warehouse.Material", null=True, blank=True, on_delete=models.PROTECT, related_name="order_items")
    name = models.CharField(max_length=250)
    unit = models.CharField(max_length=20, blank=True)
    qty = qty_field()
    price = money_field()
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=ZERO)
    amount = money_field(editable=False)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def save(self, *args, **kwargs):
        gross = Decimal(self.qty) * Decimal(self.price)
        self.amount = (gross * (1 - Decimal(self.discount_pct) / 100)).quantize(Decimal("0.01"))
        if not self.name and self.product_id:
            self.name = self.product.name
        if self.product_id and not self.unit:
            self.unit = self.product.get_unit_display()
        super().save(*args, **kwargs)


class Estimate(TenantModel, TimeStamped):
    """Smeta (tannarx). Versiyalanadi: v1, v2 ... faqat bittasi faol."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="estimates")
    version = models.PositiveSmallIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        unique_together = [("order", "version")]
        ordering = ["-version"]

    def __str__(self):
        return f"{self.order} smeta v{self.version}"


class EstimateMaterial(TenantModel):
    """A blok — materiallar (ombordan)."""

    estimate = models.ForeignKey(Estimate, on_delete=models.CASCADE, related_name="materials")
    material = models.ForeignKey("warehouse.Material", on_delete=models.PROTECT)
    qty = qty_field()
    waste_pct = models.DecimalField(max_digits=5, decimal_places=2, default=ZERO, help_text="Chiqindi, %")
    price = money_field(max_digits=18, decimal_places=4)
    currency = currency_field()

    @property
    def qty_with_waste(self) -> Decimal:
        return self.qty * (1 + self.waste_pct / 100)

    @property
    def amount(self) -> Decimal:
        return self.qty_with_waste * self.price

    def save(self, *args, **kwargs):
        self.currency = self.material.currency
        super().save(*args, **kwargs)


class EstimateService(TenantModel):
    """B blok — xizmatlar (operatsiyalar). Birlik operatsiyadan olinadi."""

    estimate = models.ForeignKey(Estimate, on_delete=models.CASCADE, related_name="services")
    operation = models.ForeignKey("production.Operation", on_delete=models.PROTECT)
    employee = models.ForeignKey("hr.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="estimate_services",
                                 help_text="Ijrochi: ishbay haq (bosqich stavkasi × miqdor) oylik va KPI'ga yoziladi")
    qty = qty_field()
    rate = money_field()
    currency = currency_field()

    @property
    def amount(self) -> Decimal:
        return self.qty * self.rate


__all__ = ["Order", "Estimate", "EstimateMaterial", "EstimateService", "Currency"]

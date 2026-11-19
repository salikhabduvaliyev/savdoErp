"""Ishlab chiqarish (MoySklad tuzilmasi asosida).

  Bosqich (Operation)          — Этап: bo'lim (ijrochi), birlik, ishbay stavka, xizmat narxi
  Texjarayon (TechProcess)     — Техпроцесс: bosqichlar ketma-ketligi
  Texkarta (TechCard)          — Техкарта: mahsulot, chiqish miqdori, materiallar me'yori (bosqichga bog'lanishi mumkin)
  Ishlab chiqarish buyurtmasi  — Заказ на производство: qaysi mahsulotdan qancha va qachongacha
  Topshiriq (ProductionJob)    — Производственное задание: texkarta × miqdor YOKI mijoz buyurtmasi (smeta)
  Bosqich topshirig'i          — ProductionTask: topshiriqning bitta bosqichi (bo'lim ekrani)
  Bosqichni bajarish           — Выполнение этапа (StageCompletion): miqdor, ijrochi → material chiqimi,
                                 ishbay haq, oxirgi bosqichda mahsulot kirimi
"""
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Max
from django.utils import timezone

from apps.core.models import Currency, TimeStamped, currency_field, money_field, qty_field
from apps.core.tenancy import TenantModel

ZERO = Decimal("0")


class Unit(models.TextChoices):
    PCS = "pcs", "dona"
    M = "m", "m"
    M2 = "m2", "m²"
    KG = "kg", "kg"
    SET = "set", "to'plam"


class Department(TenantModel):
    """Ishlab chiqarish bo'limi (bosqich ijrochisi): Kesish, Bo'yash, Yig'ish, Montaj..."""

    name = models.CharField(max_length=100)
    sequence = models.PositiveSmallIntegerField(default=10, help_text="Texnologik ketma-ketlik")
    daily_capacity = qty_field(help_text="Kunlik sig'im (operatsiya birligida)")

    class Meta:
        ordering = ["sequence", "name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_department_name")]

    def __str__(self):
        return self.name


class Operation(TenantModel):
    """Bosqich (Этап). O'lchov birligi bosqichga bog'langan."""

    name = models.CharField(max_length=100)
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="operations")
    unit = models.CharField(max_length=8, choices=Unit.choices, default=Unit.M2)
    default_rate = money_field(help_text="Xizmat narxi (smeta B blok / bosqich tannarxi)")
    rate_currency = currency_field()
    piece_rate = money_field(help_text="Ishbay to'lov stavkasi, so'm / birlik")
    employee = models.ForeignKey("hr.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="operations",
                                 help_text="Mas'ul xodim: ijrochi ko'rsatilmasa ishbay haq shu xodimga yoziladi")
    description = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["department__sequence", "name"]
        unique_together = [("name", "department")]

    def __str__(self):
        return f"{self.name} / {self.department.name}"


class TechProcess(TenantModel, TimeStamped):
    """Texjarayon — bosqichlar ketma-ketligi."""

    name = models.CharField(max_length=150)
    description = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_techprocess_name")]

    def __str__(self):
        return self.name


class TechProcessStage(TenantModel):
    process = models.ForeignKey(TechProcess, on_delete=models.CASCADE, related_name="stages")
    operation = models.ForeignKey(Operation, on_delete=models.PROTECT, related_name="process_stages")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]


class TechCard(TenantModel, TimeStamped):
    """Texkarta: `output_qty` birlik mahsulot uchun materiallar me'yori."""

    name = models.CharField(max_length=200)
    product = models.ForeignKey("warehouse.Material", on_delete=models.PROTECT, related_name="techcards")
    output_qty = qty_field(default=Decimal("1"))
    process = models.ForeignKey(TechProcess, null=True, blank=True, on_delete=models.PROTECT, related_name="techcards")
    note = models.CharField(max_length=300, blank=True)
    instructions = models.TextField(blank=True, help_text="Ishlab chiqarish ko'rsatmasi (MoySklad: Инструкции)")
    extra_cost = money_field(help_text="Qo'shimcha xarajat chiqish miqdori uchun, mahsulot valyutasida (MoySklad: Деньги)")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class TechCardMaterial(TenantModel):
    techcard = models.ForeignKey(TechCard, on_delete=models.CASCADE, related_name="materials")
    material = models.ForeignKey("warehouse.Material", on_delete=models.PROTECT, related_name="+")
    qty = qty_field(help_text="Texkartaning chiqish miqdori uchun")
    operation = models.ForeignKey(Operation, null=True, blank=True, on_delete=models.SET_NULL,
                                  help_text="Qaysi bosqichda sarflanadi (bo'sh — birinchi bosqichda)")

    class Meta:
        ordering = ["id"]


def _next_number(model, start=1):
    return max(model.objects.aggregate(m=Max("number"))["m"] or 0, start - 1) + 1


class ProductionOrder(TenantModel, TimeStamped):
    """Ishlab chiqarish buyurtmasi (Заказ на производство)."""

    class Status(models.TextChoices):
        NEW = "new", "Yangi"
        IN_PROGRESS = "in_progress", "Jarayonda"
        DONE = "done", "Bajarildi"
        CANCELLED = "cancelled", "Bekor qilindi"

    number = models.PositiveIntegerField(editable=False)
    date = models.DateField(default=timezone.localdate)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    client_order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="production_orders")
    plan_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW)
    note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-number"]
        constraints = [models.UniqueConstraint(fields=["company", "number"], name="uniq_prod_order_number")]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = _next_number(ProductionOrder)
        super().save(*args, **kwargs)


class ProductionOrderItem(TenantModel):
    production_order = models.ForeignKey(ProductionOrder, on_delete=models.CASCADE, related_name="items")
    techcard = models.ForeignKey(TechCard, on_delete=models.PROTECT, related_name="+")
    qty = qty_field()

    class Meta:
        ordering = ["id"]


class ProductionJob(TenantModel, TimeStamped):
    """Ishlab chiqarish topshirig'i (Производственное задание)."""

    class Status(models.TextChoices):
        NEW = "new", "Yangi"
        IN_PROGRESS = "in_progress", "Jarayonda"
        DONE = "done", "Bajarildi"
        CANCELLED = "cancelled", "Bekor qilindi"

    number = models.PositiveIntegerField(editable=False)
    date = models.DateField(default=timezone.localdate)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    production_order = models.ForeignKey(ProductionOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.CASCADE, related_name="jobs",
                              help_text="Mijoz buyurtmasi (smeta asosida) — individual buyurtmalar uchun")
    techcard = models.ForeignKey(TechCard, null=True, blank=True, on_delete=models.PROTECT, related_name="jobs")
    qty = qty_field(help_text="Rejalashtirilgan miqdor (mahsulot birligida)")
    produced_qty = qty_field()
    materials_warehouse = models.ForeignKey("warehouse.Warehouse", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    products_warehouse = models.ForeignKey("warehouse.Warehouse", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    plan_start = models.DateField(null=True, blank=True)
    plan_end = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    capitalized = money_field(help_text="Omborga kirim qilingan mahsulot qiymati (mahsulot valyutasida)")
    allow_negative = models.BooleanField(default=False, help_text="Material yetmasa ham boshlash (qoldiq minusga ketadi)")
    note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-number"]
        constraints = [models.UniqueConstraint(fields=["company", "number"], name="uniq_job_number")]

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = _next_number(ProductionJob)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Topshiriq №{self.number}"

    @property
    def title(self):
        if self.techcard_id:
            return self.techcard.product.name
        if self.order_id:
            return f"Buyurtma №{self.order.number} · {self.order.client.name}"
        return "—"

    @property
    def progress(self) -> Decimal:
        tasks = list(self.tasks.all())
        if not tasks:
            return ZERO
        return sum((t.progress for t in tasks), ZERO) / len(tasks)


class ProductionTask(TenantModel, TimeStamped):
    """Topshiriqning bitta bosqichi (bo'lim boshlig'i ekranidagi kartochka)."""

    class Status(models.TextChoices):
        WAITING = "waiting", "Kutilmoqda"
        IN_PROGRESS = "in_progress", "Jarayonda"
        PAUSED = "paused", "To'xtatilgan"
        BLOCKED = "blocked", "Material yo'q"
        DONE = "done", "Tugatildi"

    job = models.ForeignKey(ProductionJob, null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")
    position = models.PositiveSmallIntegerField(default=0)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.CASCADE, related_name="tasks")
    operation = models.ForeignKey(Operation, on_delete=models.PROTECT, related_name="tasks")
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="tasks", editable=False)
    plan_qty = qty_field()
    done_qty = qty_field()
    defect_qty = qty_field(help_text="Brak miqdori")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.WAITING)
    deadline = models.DateField(null=True, blank=True)
    planned_date = models.DateField(null=True, blank=True, help_text="Bo'lim rejasidagi kun")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    blocked_reason = models.CharField(max_length=300, blank=True)
    drawing = models.FileField(upload_to="drawings/", null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["deadline", "position", "id"]

    def save(self, *args, **kwargs):
        self.department_id = self.operation.department_id
        super().save(*args, **kwargs)

    @property
    def unit(self):
        return self.operation.unit

    @property
    def remaining(self) -> Decimal:
        return max(ZERO, self.plan_qty - self.done_qty)

    @property
    def progress(self) -> Decimal:
        if not self.plan_qty:
            return ZERO
        return min(Decimal("1"), self.done_qty / self.plan_qty)

    @property
    def is_overdue(self):
        return bool(self.deadline and self.status != self.Status.DONE and self.deadline < timezone.localdate())

    @property
    def overdue_days(self):
        if not self.is_overdue:
            return 0
        return (timezone.localdate() - self.deadline).days

    def _notify(self):
        if self.order_id:
            self.order.on_task_changed()
        if self.job_id:
            from .services import refresh_job_status

            refresh_job_status(self.job)

    # --- holat o'tishlari (bo'lim ekrani) ---
    def start(self):
        if self.status not in (self.Status.WAITING, self.Status.PAUSED, self.Status.BLOCKED):
            raise ValidationError("Topshiriqni bu holatdan boshlab bo'lmaydi")
        if self.order_id:
            from apps.warehouse.services import order_shortages

            shortages = [s for s in order_shortages(self.order) if s["shortage"] > 0]
            if shortages:
                self.status = self.Status.BLOCKED
                self.blocked_reason = "; ".join(
                    f"{s['material']}: yetishmaydi {s['shortage']} {s['unit']}" for s in shortages
                )
                self.save()
                return False
        self.status = self.Status.IN_PROGRESS
        self.blocked_reason = ""
        self.started_at = self.started_at or timezone.now()
        self.save()
        self._notify()
        return True

    def pause(self, reason=""):
        if self.status != self.Status.IN_PROGRESS:
            raise ValidationError("Faqat jarayondagi topshiriqni to'xtatish mumkin")
        self.status = self.Status.PAUSED
        self.note = reason or self.note
        self.save()

    def report(self, done_qty=None, defect_qty=None, employee=None, user=None):
        """Bajarilgan miqdorni kiritish — bosqichni bajarish yozuvi orqali (farq qo'shiladi)."""
        from .services import complete_stage

        if done_qty is not None:
            delta = Decimal(done_qty) - self.done_qty
            if delta < 0:
                raise ValidationError("Bajarilgan miqdorni kamaytirib bo'lmaydi")
            if delta > 0:
                complete_stage(self, delta, defect_qty=Decimal(defect_qty or 0), employee=employee, user=user)
                return
        if defect_qty is not None:
            self.defect_qty = Decimal(defect_qty)
            self.save()

    def finish(self, employee=None, user=None):
        from .services import complete_stage

        if self.status == self.Status.DONE:
            raise ValidationError("Bosqich allaqachon tugatilgan")
        if self.remaining > 0:
            complete_stage(self, self.remaining, employee=employee, user=user)
        self.refresh_from_db()
        if self.status != self.Status.DONE:
            self.status = self.Status.DONE
            self.finished_at = timezone.now()
            self.save()
            self._notify()

    def __str__(self):
        return f"{self.job_id or self.order_id} · {self.operation}"


class StageCompletion(TenantModel, TimeStamped):
    """Bosqichni bajarish (Выполнение этапа)."""

    task = models.ForeignKey(ProductionTask, on_delete=models.CASCADE, related_name="completions")
    date = models.DateField(default=timezone.localdate)
    qty = qty_field()
    defect_qty = qty_field()
    employee = models.ForeignKey("hr.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="stage_completions")
    piece_rate = money_field()
    amount = money_field(help_text="Ishbay haq, so'm")
    note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-id"]


class PurchaseRequest(TenantModel, TimeStamped):
    """Material yetishmasa ishlab chiqarish menejeriga avtomatik zayavka."""

    class Status(models.TextChoices):
        OPEN = "open", "Ochiq"
        ORDERED = "ordered", "Buyurtma berildi"
        CLOSED = "closed", "Yopildi"

    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="purchase_requests")
    job = models.ForeignKey(ProductionJob, null=True, blank=True, on_delete=models.SET_NULL, related_name="purchase_requests")
    material = models.ForeignKey("warehouse.Material", on_delete=models.PROTECT)
    qty = qty_field()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-created_at"]


__all__ = [
    "Unit", "Department", "Operation", "TechProcess", "TechProcessStage", "TechCard", "TechCardMaterial",
    "ProductionOrder", "ProductionOrderItem", "ProductionJob", "ProductionTask", "StageCompletion",
    "PurchaseRequest", "Currency",
]

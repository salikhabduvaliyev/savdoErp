from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStamped, money_field, qty_field
from apps.core.tenancy import TenantModel

ZERO = Decimal("0")


class Employee(TenantModel, TimeStamped):
    """Ish haqi faqat so'mda yuritiladi."""

    class PaySystem(models.TextChoices):
        PIECE = "piece", "Ishbay"
        SALARY = "salary", "Oklad"
        SALARY_PLAN = "salary_plan", "Oklad+plan"

    full_name = models.CharField(max_length=200)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="employee")
    department = models.ForeignKey("production.Department", null=True, blank=True, on_delete=models.SET_NULL)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="employees")
    position = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    hired_at = models.DateField("Ishga kirgan sana", null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)
    pay_system = models.CharField(max_length=16, choices=PaySystem.choices, default=PaySystem.SALARY)
    base_salary = money_field(help_text="Oklad, so'm / oy (to'liq ish kunlari uchun)")
    kpi_bonus_base = money_field(help_text="KPI bonus bazasi, so'm; bonus = baza × koeffitsiyent")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class Timesheet(TenantModel):
    """Davomat (tabel): oy bo'yicha ishlangan kunlar."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="timesheets")
    month = models.DateField(help_text="Oyning 1-sanasi")
    days_worked = models.PositiveSmallIntegerField(default=0)
    working_days = models.PositiveSmallIntegerField(default=22, help_text="Oydagi ish kunlari normasi")

    class Meta:
        unique_together = [("employee", "month")]


class PieceworkEntry(TenantModel, TimeStamped):
    """Ishbay topshiriq bajarilishi. Summa buyurtma smetasining D blokiga tushadi."""

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="piecework")
    task = models.ForeignKey("production.ProductionTask", null=True, blank=True, on_delete=models.PROTECT, related_name="piecework")
    estimate_service = models.OneToOneField("orders.EstimateService", null=True, blank=True, on_delete=models.CASCADE,
                                            related_name="piecework", help_text="Texkartasiz buyurtma: smetaning B blokidagi xizmat")
    date = models.DateField(default=timezone.localdate)
    qty = qty_field()
    rate = money_field(help_text="so'm / birlik")
    amount = money_field(editable=False)

    class Meta:
        ordering = ["-date"]

    def save(self, *args, **kwargs):
        if not self.rate:
            op = self.task.operation if self.task_id else (self.estimate_service.operation if self.estimate_service_id else None)
            self.rate = op.piece_rate if op else 0
        self.amount = (Decimal(self.qty) * Decimal(self.rate)).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)


class PayrollAdjustment(TenantModel, TimeStamped):
    class Kind(models.TextChoices):
        ADVANCE = "advance", "Avans"
        DEDUCTION = "deduction", "Ushlanma"
        BONUS = "bonus", "Qo'shimcha mukofot"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="adjustments")
    month = models.DateField()
    kind = models.CharField(max_length=12, choices=Kind.choices)
    amount = money_field()
    note = models.CharField(max_length=200, blank=True)


class KpiTemplate(TenantModel):
    """KPI shabloni.

    Maketda formulalar aniqlanmagan edi. Endi:
      * direction=higher: bajarilish = fakt / reja (sotuv, muddatida topshirish)
      * direction=lower:  bajarilish = reja / fakt (brak — kam bo'lgani yaxshi)
      * cap_pct: yuqori chegara (99,4/99 = 100,4% → cap=100 bo'lsa 100%)
      * koeffitsiyent KpiScale jadvalidan (bajarilish % oralig'i bo'yicha)
    """

    class Direction(models.TextChoices):
        HIGHER = "higher", "Ko'p — yaxshi"
        LOWER = "lower", "Kam — yaxshi"

    name = models.CharField(max_length=100)
    unit = models.CharField(max_length=20, blank=True, help_text="mln, %, ...")
    direction = models.CharField(max_length=8, choices=Direction.choices, default=Direction.HIGHER)
    source = models.CharField(max_length=16, default="manual", help_text="Fakt manbai (kpi_auto.SOURCES): manual — qo'lda")
    cap_pct = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("150"))

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_kpi_template_name")]

    def __str__(self):
        return self.name


class KpiScale(TenantModel):
    """Bajarilish foizidan koeffitsiyentga o'tish (template=None — umumiy shkala)."""

    template = models.ForeignKey(KpiTemplate, null=True, blank=True, on_delete=models.CASCADE, related_name="scale")
    min_pct = models.DecimalField(max_digits=6, decimal_places=2)
    coefficient = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta:
        ordering = ["-min_pct"]


class KpiResult(TenantModel, TimeStamped):
    template = models.ForeignKey(KpiTemplate, on_delete=models.PROTECT, related_name="results")
    month = models.DateField()
    employee = models.ForeignKey(Employee, null=True, blank=True, on_delete=models.CASCADE, related_name="kpi_results")
    department = models.ForeignKey("production.Department", null=True, blank=True, on_delete=models.CASCADE)
    plan = models.DecimalField(max_digits=18, decimal_places=3)
    fact = models.DecimalField(max_digits=18, decimal_places=3, default=0)

    class Meta:
        ordering = ["-month", "id"]

    @property
    def achievement_pct(self) -> Decimal:
        if self.template.direction == KpiTemplate.Direction.HIGHER:
            pct = (self.fact / self.plan * 100) if self.plan else ZERO
        else:
            pct = (self.plan / self.fact * 100) if self.fact else Decimal("100")
        return min(Decimal(pct), Decimal(str(self.template.cap_pct))).quantize(Decimal("0.1"))

    @property
    def coefficient(self) -> Decimal:
        pct = self.achievement_pct
        scale = list(self.template.scale.all()) or list(KpiScale.objects.filter(template__isnull=True))
        for row in sorted(scale, key=lambda r: r.min_pct, reverse=True):
            if pct >= row.min_pct:
                return row.coefficient
        return ZERO

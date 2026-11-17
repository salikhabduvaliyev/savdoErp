"""Savdo: sotuv hujjatlari.

* Oddiy sotuv — tovarlar ro'yxati (narx turi bo'yicha narx), ombordan chiqim.
* Buyurtmadan sotuv — tayyor buyurtma sotuvga aylantiriladi: bitta qator "Buyurtma №",
  buyurtmaga oldin to'langan avanslar sotuv to'loviga qo'shiladi, qarz ikki marta hisoblanmaydi.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Max, Q, Sum
from django.utils import timezone

from apps.core.models import TimeStamped, currency_field, money_field, qty_field
from apps.core.tenancy import TenantModel

ZERO = Decimal("0")


class Sale(TenantModel, TimeStamped):
    class Status(models.TextChoices):
        DRAFT = "draft", "Qoralama"
        COMPLETED = "completed", "Yakunlangan"
        CANCELLED = "cancelled", "Bekor qilingan"

    number = models.PositiveIntegerField(editable=False)
    date = models.DateField(default=timezone.localdate)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="sales")
    client = models.ForeignKey("crm.Counterparty", on_delete=models.PROTECT, related_name="sales")
    warehouse = models.ForeignKey("warehouse.Warehouse", null=True, blank=True, on_delete=models.PROTECT, related_name="sales")
    price_type = models.ForeignKey("warehouse.PriceType", null=True, blank=True, on_delete=models.SET_NULL)
    currency = currency_field()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="sales")
    discount = money_field(help_text="Hujjat bo'yicha chegirma (summa)")
    note = models.CharField(max_length=500, blank=True)
    extra = models.JSONField(default=dict, blank=True, help_text="Qo'shimcha maydonlar")
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="sales_made")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-number"]
        constraints = [models.UniqueConstraint(fields=["company", "number"], name="uniq_sale_number")]

    def __str__(self):
        return f"Sotuv №{self.number}"

    def save(self, *args, **kwargs):
        if not self.number:
            from apps.core.models import SystemSettings

            start = SystemSettings.load().sale_number_start
            last = max(Sale.objects.aggregate(m=Max("number"))["m"] or 0, start)
            self.number = last + 1
        super().save(*args, **kwargs)

    @property
    def subtotal(self) -> Decimal:
        if hasattr(self, "_subtotal"):
            return self._subtotal or ZERO
        return self.items.aggregate(s=Sum("amount"))["s"] or ZERO

    @property
    def total(self) -> Decimal:
        return self.subtotal - (self.discount or ZERO)

    def payments_qs(self):
        from apps.finance.models import Transaction

        cond = Q(sale=self)
        if self.order_id:
            # buyurtmaga oldin to'langan avanslar ham shu sotuvga hisoblanadi
            cond |= Q(order_id=self.order_id, sale__isnull=True)
        return Transaction.objects.filter(cond, kind=Transaction.Kind.CLIENT_PAYMENT)

    @property
    def paid(self) -> Decimal:
        if hasattr(self, "_paid"):
            return self._paid or ZERO
        return self.payments_qs().aggregate(s=Sum("order_amount"))["s"] or ZERO

    @property
    def debt(self) -> Decimal:
        """Qarz faqat yakunlangan sotuvda (qoralama hali realizatsiya emas)."""
        if self.status != self.Status.COMPLETED:
            return ZERO
        return self.total - self.paid

    @property
    def cost(self) -> Decimal:
        return self.items.aggregate(s=Sum("cost_amount"))["s"] or ZERO


class SaleItem(TenantModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("warehouse.Material", null=True, blank=True, on_delete=models.PROTECT, related_name="sale_items")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="sale_items")
    name = models.CharField(max_length=250)
    unit = models.CharField(max_length=20, blank=True)
    qty = qty_field()
    price = money_field()
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=ZERO)
    amount = money_field(editable=False)
    cost_amount = money_field(editable=False, help_text="Tannarx (sotuv valyutasida) — yakunlanganda yoziladi")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def save(self, *args, **kwargs):
        gross = Decimal(self.qty) * Decimal(self.price)
        self.amount = (gross * (1 - Decimal(self.discount_pct) / 100)).quantize(Decimal("0.01"))
        if not self.name:
            self.name = self.product.name if self.product_id else (f"Buyurtma №{self.order.number}" if self.order_id else "—")
        if self.product_id and not self.unit:
            self.unit = self.product.get_unit_display()
        super().save(*args, **kwargs)

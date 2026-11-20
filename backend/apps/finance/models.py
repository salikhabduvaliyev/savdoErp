from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStamped, currency_field, money_field
from apps.core.tenancy import TenantModel


class Account(TenantModel):
    class Kind(models.TextChoices):
        CASH = "cash", "Kassa"
        BANK = "bank", "Bank"

    name = models.CharField(max_length=100)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="accounts")
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.CASH)
    currency = currency_field()
    opening_balance = money_field()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "currency", "name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_account_name")]

    def __str__(self):
        return self.name


class ExpenseCategory(TenantModel):
    """Xarajat moddasi. `affects_profit=False` — foyda-zararga kirmaydi (masalan: qarz qaytarish,
    ta'sischi olib chiqishi, hisoblar orasidagi o'tkazma)."""

    name = models.CharField(max_length=100)
    affects_profit = models.BooleanField("Foydaga ta'sir qiladi", default=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_category_name")]

    def __str__(self):
        return self.name


class Transaction(TenantModel, TimeStamped):
    """Pul harakati. Valyuta har doim hisob (kassa/bank) valyutasi.

    Agar buyurtmaga biriktirilsa, `order_amount` — buyurtma valyutasidagi ekvivalent
    (operatsiya sanasidagi kurs bo'yicha). Shu bilan USD buyurtmaga so'mda to'lov
    yoki so'mdagi xarajat to'g'ri hisoblanadi.

    Smetaning C bloki aynan shu jadvaldan olinadi — sanalar endi ikki joyda
    farq qilmaydi (maketda transport 12.10 / 18.10 deb har xil edi).
    """

    class Direction(models.TextChoices):
        IN = "in", "Kirim"
        OUT = "out", "Chiqim"

    class Kind(models.TextChoices):
        CLIENT_PAYMENT = "client_payment", "Mijoz to'lovi"
        SUPPLIER_PAYMENT = "supplier_payment", "Yetkazuvchiga to'lov"
        EXPENSE = "expense", "Xarajat"
        SALARY = "salary", "Ish haqi"
        OTHER_INCOME = "other_income", "Boshqa kirim"
        TRANSFER_OUT = "transfer_out", "Ko'chirish (chiqim)"
        TRANSFER_IN = "transfer_in", "Ko'chirish (kirim)"

    KIND_DIRECTION = {
        Kind.CLIENT_PAYMENT: Direction.IN,
        Kind.OTHER_INCOME: Direction.IN,
        Kind.SUPPLIER_PAYMENT: Direction.OUT,
        Kind.EXPENSE: Direction.OUT,
        Kind.SALARY: Direction.OUT,
        Kind.TRANSFER_OUT: Direction.OUT,
        Kind.TRANSFER_IN: Direction.IN,
    }

    number = models.PositiveIntegerField(null=True, blank=True, editable=False, help_text="Kirim/chiqim bo'yicha alohida raqam")
    date = models.DateField(default=timezone.localdate)
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="transactions")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    direction = models.CharField(max_length=3, choices=Direction.choices, editable=False)
    amount = money_field(help_text="Har doim musbat")
    currency = currency_field(editable=False)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="transactions")
    order_amount = money_field(null=True, blank=True, default=None, help_text="Buyurtma valyutasidagi summa")
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="transactions")
    client = models.ForeignKey("crm.Counterparty", null=True, blank=True, on_delete=models.PROTECT, related_name="client_transactions")
    supplier = models.ForeignKey("crm.Counterparty", null=True, blank=True, on_delete=models.PROTECT, related_name="supplier_transactions")
    employee = models.ForeignKey("hr.Employee", null=True, blank=True, on_delete=models.PROTECT, related_name="salary_payments",
                                 help_text="Ish haqi to'lovi — qaysi xodimga (oylik vedomostda to'langan sifatida)")
    category = models.ForeignKey(ExpenseCategory, null=True, blank=True, on_delete=models.PROTECT)
    stock_doc = models.ForeignKey("warehouse.StockDoc", null=True, blank=True, on_delete=models.SET_NULL, related_name="payments",
                                  help_text="Yetkazuvchiga to'lov — qaysi qabul qilish uchun")
    pair = models.OneToOneField("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                                help_text="Hisoblar orasida ko'chirish — juft yozuv")
    description = models.CharField(max_length=300, blank=True)
    accrual_date = models.DateField(null=True, blank=True,
                                    help_text="Hisoblash sanasi (MoySklad: Дата начисления) — xarajat foyda-zararda shu sanada; bo'sh — to'lov sanasi")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-date", "-id"]

    def clean(self):
        if self.amount is None or self.amount <= 0:
            raise ValidationError({"amount": "Summa musbat bo'lishi kerak"})
        if self.kind == self.Kind.CLIENT_PAYMENT and not (self.order_id or self.client_id or self.sale_id):
            raise ValidationError("Mijoz to'lovi uchun buyurtma, sotuv yoki mijozni tanlang")
        if self.kind == self.Kind.SUPPLIER_PAYMENT and not self.supplier_id:
            raise ValidationError({"supplier": "Yetkazuvchini tanlang"})
        if self.kind == self.Kind.EXPENSE and not self.category_id:
            raise ValidationError({"category": "Xarajat turini tanlang"})
        if self.employee_id and self.kind != self.Kind.SALARY:
            raise ValidationError({"employee": "Xodim faqat ish haqi to'lovida tanlanadi"})
        if self.sale_id and self.kind != self.Kind.CLIENT_PAYMENT:
            raise ValidationError("Sotuvga faqat mijoz to'lovi biriktiriladi")

    @property
    def document(self):
        """To'lov biriktirilgan hujjat (valyutasi `order_amount` uchun)."""
        return self.sale if self.sale_id else (self.order if self.order_id else None)

    def save(self, *args, **kwargs):
        from apps.core.money import convert

        self.direction = self.KIND_DIRECTION[self.kind]
        self.currency = self.account.currency
        if not self.number:
            from django.db.models import Max

            self.number = (Transaction.objects.filter(direction=self.direction).aggregate(m=Max("number"))["m"] or 0) + 1
        if self.sale_id:
            self.client_id = self.client_id or self.sale.client_id
            self.order_id = self.order_id or self.sale.order_id
        if self.order_id and not self.client_id and self.kind == self.Kind.CLIENT_PAYMENT:
            self.client_id = self.order.client_id
        doc = self.document
        if doc is not None:
            # order_amount — hujjat (buyurtma/sotuv) valyutasidagi ekvivalent
            if self.order_amount is None or self.currency == doc.currency:
                self.order_amount = convert(self.amount, self.currency, doc.currency, self.date)
        else:
            self.order_amount = None
        super().save(*args, **kwargs)

    @property
    def signed_amount(self) -> Decimal:
        return self.amount if self.direction == self.Direction.IN else -self.amount


class Adjustment(TenantModel, TimeStamped):
    """Korrektirovka (MoySklad "Корректировки"): hisob (kassa/bank) qoldig'ini yoki kontragent bilan
    o'zaro hisob-kitob balansini qo'lda to'g'rilash. Summa ishorali.

    Hisob: + qoldiqni oshiradi, − kamaytiradi.
    Kontragent: + kontragent foydasiga (bizning qarzimiz oshadi / uning qarzi kamayadi), − uning qarzi oshadi.
    """

    class Kind(models.TextChoices):
        ACCOUNT = "account", "Hisob qoldig'i"
        COUNTERPARTY = "counterparty", "O'zaro hisob-kitob"

    number = models.PositiveIntegerField(editable=False)
    date = models.DateField(default=timezone.localdate)
    kind = models.CharField(max_length=14, choices=Kind.choices)
    account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="adjustments")
    counterparty = models.ForeignKey("crm.Counterparty", null=True, blank=True, on_delete=models.PROTECT, related_name="adjustments")
    amount = models.DecimalField(max_digits=18, decimal_places=2, help_text="Ishorali summa")
    currency = currency_field()
    note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-number"]

    def clean(self):
        if not self.amount:
            raise ValidationError({"amount": "Summa noldan farq qilishi kerak"})
        if self.kind == self.Kind.ACCOUNT and not self.account_id:
            raise ValidationError({"account": "Hisobni tanlang"})
        if self.kind == self.Kind.COUNTERPARTY and not self.counterparty_id:
            raise ValidationError({"counterparty": "Kontragentni tanlang"})

    def save(self, *args, **kwargs):
        if self.kind == self.Kind.ACCOUNT and self.account_id:
            self.currency = self.account.currency
            self.counterparty = None
        if self.kind == self.Kind.COUNTERPARTY:
            self.account = None
        if not self.number:
            from django.db.models import Max

            self.number = (Adjustment.objects.aggregate(m=Max("number"))["m"] or 0) + 1
        super().save(*args, **kwargs)

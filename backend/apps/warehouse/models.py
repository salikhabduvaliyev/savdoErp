from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStamped, currency_field, money_field, qty_field
from apps.core.tenancy import TenantModel
from apps.production.models import Unit


class Warehouse(TenantModel):
    name = models.CharField(max_length=100)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="warehouses")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_warehouse_name")]

    def __str__(self):
        return self.name


class MaterialGroup(TenantModel):
    """Tovar guruhi (kategoriya)."""

    name = models.CharField(max_length=100)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_group_name")]

    def __str__(self):
        return self.name


class PriceType(TenantModel):
    """Narx turi: Chakana, Ulgurji, Diler..."""

    name = models.CharField(max_length=100)
    currency = currency_field()
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_pricetype_name")]

    def __str__(self):
        return self.name


class Material(TenantModel, TimeStamped):
    """Tovar / nomenklatura: xomashyo, tayyor mahsulot, qayta sotiladigan tovar yoki xizmat.

    Tannarx (o'rtacha narx) `currency` valyutasida yuritiladi; sotuv narxlari — narx turlari bo'yicha.
    """

    class Type(models.TextChoices):
        RAW = "raw", "Xomashyo / material"
        PRODUCT = "product", "Tayyor mahsulot"
        GOODS = "goods", "Tovar (qayta sotish)"
        SERVICE = "service", "Xizmat"

    name = models.CharField(max_length=200)
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.RAW)
    sku = models.CharField("Artikul", max_length=50, blank=True)
    barcode = models.CharField("Shtrix-kod", max_length=64, blank=True)
    group = models.ForeignKey(MaterialGroup, null=True, blank=True, on_delete=models.SET_NULL)
    unit = models.CharField(max_length=8, choices=Unit.choices, default=Unit.PCS)
    currency = currency_field(help_text="Tannarx (xarid) valyutasi")
    purchase_price = money_field(max_digits=18, decimal_places=4, help_text="Oxirgi/rejalashtirilgan xarid narxi")
    min_qty = qty_field(help_text="Minimal qoldiq (barcha omborlar bo'yicha)")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def is_stocked(self):
        return self.type != self.Type.SERVICE

    def price_for(self, price_type):
        if not price_type:
            return None
        p = self.prices.filter(price_type=price_type).first()
        return p.price if p else None


class ProductPrice(TenantModel):
    product = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="prices")
    price_type = models.ForeignKey(PriceType, on_delete=models.CASCADE, related_name="prices")
    price = money_field()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "price_type"], name="uniq_product_price")]


class Stock(TenantModel):
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="stocks")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stocks")
    qty = qty_field()
    reserved = qty_field()
    avg_cost = money_field(max_digits=18, decimal_places=4)

    class Meta:
        unique_together = [("material", "warehouse")]
        ordering = ["material__name"]

    @property
    def available(self) -> Decimal:
        return self.qty - self.reserved

    @property
    def value(self) -> Decimal:
        return self.qty * self.avg_cost

    @property
    def state(self):
        from apps.core.models import SystemSettings

        return self.state_for(SystemSettings.load().stock_near_min_ratio)

    def state_for(self, ratio):
        """mavjud <= minimal → low; mavjud <= minimal × koeff. → near_min; aks holda ok."""
        minimum = self.material.min_qty
        if not minimum:
            return "ok"
        if self.available <= minimum:
            return "low"
        if self.available <= minimum * Decimal(str(ratio)):
            return "near_min"
        return "ok"


class Reservation(TenantModel):
    """Buyurtma uchun rezerv. Stock.reserved = shu jadval yig'indisi."""

    order = models.ForeignKey("orders.Order", on_delete=models.CASCADE, related_name="reservations")
    material = models.ForeignKey(Material, on_delete=models.CASCADE)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE)
    qty = qty_field()

    class Meta:
        unique_together = [("order", "material", "warehouse")]


class StockMove(TenantModel, TimeStamped):
    class Type(models.TextChoices):
        IN = "in", "Kirim"
        OUT = "out", "Chiqim"
        TRANSFER = "transfer", "Ichki o'tkazma"
        ADJUST = "adjust", "Inventarizatsiya tuzatmasi"

    date = models.DateField(default=timezone.localdate)
    type = models.CharField(max_length=10, choices=Type.choices)
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name="moves")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="moves")
    to_warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="moves_in")
    qty = qty_field(help_text="Inventarizatsiyada: farq (+/-)")
    price = money_field(max_digits=18, decimal_places=4, help_text="Kirimda — xarid narxi; chiqimda — o'rtacha narx")
    currency = currency_field()
    supplier = models.ForeignKey("crm.Counterparty", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_moves")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_moves")
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_moves")
    job = models.ForeignKey("production.ProductionJob", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_moves")
    doc = models.ForeignKey("warehouse.StockDoc", null=True, blank=True, on_delete=models.PROTECT, related_name="moves")
    note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-date", "-id"]

    @property
    def amount(self):
        return self.qty * self.price


class StockDoc(TenantModel, TimeStamped):
    """Ombor/xarid hujjati (MoySklad uslubi): bir nechta pozitsiya, "o'tkazilgan" (Проведено) belgisi.

    O'tkazilganda qoldiqqa ta'sir qiladi (StockMove.doc), o'tkazilmagani — qoralama.
    """

    class Type(models.TextChoices):
        PURCHASE_ORDER = "purchase_order", "Yetkazuvchiga buyurtma"
        SUPPLY = "supply", "Qabul qilish"
        PURCHASE_RETURN = "purchase_return", "Yetkazuvchiga qaytarish"
        ENTER = "enter", "Kirim"
        LOSS = "loss", "Hisobdan chiqarish"
        MOVE = "move", "Ko'chirish"
        INVENTORY = "inventory", "Inventarizatsiya"
        SALES_RETURN = "sales_return", "Mijoz qaytarishi"

    # qaysi modul huquqi bilan ishlanadi
    MODULE = {
        "purchase_order": "purchases", "supply": "purchases", "purchase_return": "purchases",
        "enter": "warehouse", "loss": "warehouse", "move": "warehouse", "inventory": "warehouse",
        "sales_return": "sales",
    }

    type = models.CharField(max_length=20, choices=Type.choices)
    number = models.PositiveIntegerField(editable=False)
    date = models.DateField(default=timezone.localdate)
    branch = models.ForeignKey("core.Branch", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_docs")
    warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="docs")
    to_warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="docs_in")
    counterparty = models.ForeignKey("crm.Counterparty", null=True, blank=True, on_delete=models.PROTECT, related_name="stock_docs")
    currency = currency_field()
    posted = models.BooleanField(default=True, help_text="O'tkazilgan (qoldiqqa ta'sir qiladi)")
    plan_date = models.DateField(null=True, blank=True, help_text="Yetkazuvchiga buyurtma: kutilgan sana")
    source = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="derived",
                               help_text="Asos hujjat (buyurtma → qabul qilish → qaytarish)")
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="returns")
    note = models.TextField(blank=True)
    extra = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-date", "-number"]
        constraints = [models.UniqueConstraint(fields=["company", "type", "number"], name="uniq_stockdoc_number")]

    def __str__(self):
        return f"{self.get_type_display()} №{self.number}"

    def save(self, *args, **kwargs):
        if not self.number:
            last = StockDoc.objects.filter(type=self.type).aggregate(m=models.Max("number"))["m"] or 0
            self.number = last + 1
        super().save(*args, **kwargs)

    @property
    def total(self) -> Decimal:
        return sum((i.amount for i in self.items.all()), Decimal("0"))


class StockDocItem(TenantModel):
    doc = models.ForeignKey(StockDoc, on_delete=models.CASCADE, related_name="items")
    material = models.ForeignKey(Material, on_delete=models.PROTECT, related_name="doc_items")
    qty = qty_field(help_text="Inventarizatsiyada — haqiqiy (sanalgan) miqdor")
    book_qty = qty_field(null=True, blank=True, help_text="Inventarizatsiya: hisobdagi qoldiq")
    price = money_field(max_digits=18, decimal_places=4)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    amount = money_field(editable=False)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def save(self, *args, **kwargs):
        q = Decimal(self.qty)
        if self.doc.type == StockDoc.Type.INVENTORY and self.book_qty is not None:
            q = Decimal(self.qty) - Decimal(self.book_qty)  # farq summasi
        self.amount = (q * Decimal(self.price) * (1 - Decimal(self.discount_pct) / 100)).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)

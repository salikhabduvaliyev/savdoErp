from django.db import models

from apps.core.models import TimeStamped
from apps.core.tenancy import TenantModel


class Kind(models.TextChoices):
    LEGAL = "legal", "Yuridik shaxs"
    INDIVIDUAL = "individual", "Jismoniy shaxs"


class CounterpartyGroup(TenantModel):
    """Kontragent guruhi (teglar): "Mijozlar", "Yetkazuvchilar", "Dilerlar"..."""

    name = models.CharField(max_length=100)
    color = models.CharField(max_length=20, default="#2563eb")

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_cp_group_name")]

    def __str__(self):
        return self.name


class CounterpartyStatus(TenantModel):
    """Kontragent holati (voronka): Yangi, Muzokara, Doimiy mijoz..."""

    name = models.CharField(max_length=100)
    color = models.CharField(max_length=20, default="#f59e0b")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uniq_cp_status_name")]

    def __str__(self):
        return self.name


class Counterparty(TenantModel, TimeStamped):
    """Kontragent: bir vaqtda ham mijoz, ham yetkazuvchi bo'lishi mumkin."""

    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.INDIVIDUAL)
    is_client = models.BooleanField("Mijoz", default=True)
    is_supplier = models.BooleanField("Yetkazuvchi", default=True)
    groups = models.ManyToManyField(CounterpartyGroup, blank=True, related_name="counterparties")
    status = models.ForeignKey(CounterpartyStatus, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    code = models.CharField("Kod", max_length=50, blank=True)
    owner = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                              help_text="Mas'ul xodim")
    extra = models.JSONField(default=dict, blank=True, help_text="Qo'shimcha maydonlar")
    phone = models.CharField(max_length=32, blank=True)
    phone2 = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    contact_person = models.CharField("Mas'ul shaxs", max_length=200, blank=True)
    inn = models.CharField("STIR", max_length=20, blank=True)
    bank_name = models.CharField(max_length=200, blank=True)
    bank_mfo = models.CharField(max_length=10, blank=True)
    bank_account = models.CharField(max_length=30, blank=True)
    source = models.CharField("Qayerdan keldi", max_length=100, blank=True)
    supplies = models.CharField("Nima yetkazadi", max_length=200, blank=True)
    price_type = models.ForeignKey("warehouse.PriceType", null=True, blank=True, on_delete=models.SET_NULL,
                                   help_text="Sotuvda standart narx turi")
    note = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CounterpartyNote(TenantModel, TimeStamped):
    """Kontragent bo'yicha hodisalar / izohlar."""

    counterparty = models.ForeignKey(Counterparty, on_delete=models.CASCADE, related_name="notes")
    text = models.TextField()
    created_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at"]

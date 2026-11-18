"""Yangi kompaniyani ro'yxatdan o'tkazish (onboarding)."""
from django.db import transaction
from django.utils import timezone

from apps.core.models import Branch, Company, ExchangeRate, SystemSettings
from apps.core.tenancy import tenant_context

from .models import DEFAULT_ROLES, Role, User


def ensure_default_roles(company):
    with tenant_context(company):
        for code, name, desc, perms, own in DEFAULT_ROLES:
            if not Role.objects.filter(code=code).exists():
                Role.objects.create(code=code, name=name, description=desc, permissions=perms,
                                    own_department_only=own, is_system=True)


def bootstrap_company(company):
    """Kompaniya uchun boshlang'ich ma'lumotnomalar: filial, rollar, kassa, ombor, narx turlari."""
    from apps.finance.models import Account, ExpenseCategory
    from apps.warehouse.models import PriceType, Warehouse

    ensure_default_roles(company)
    with tenant_context(company):
        main = Branch.objects.filter(is_main=True).first() or Branch.objects.create(name="Bosh ofis", is_main=True)
        SystemSettings.load()
        from apps.core.currency import ensure_default_currencies

        ensure_default_currencies()
        if not Account.objects.exists():
            Account.objects.create(name="Kassa (so'm)", kind="cash", currency="UZS", branch=main)
            Account.objects.create(name="Kassa (USD)", kind="cash", currency="USD", branch=main)
        if not Warehouse.objects.exists():
            Warehouse.objects.create(name="Asosiy ombor", branch=main)
        if not PriceType.objects.exists():
            PriceType.objects.create(name="Chakana", currency="UZS", is_default=True)
            PriceType.objects.create(name="Ulgurji", currency="UZS")
        if not ExpenseCategory.objects.exists():
            for name, affects in [("Transport", True), ("Subpodryad", True), ("Ijara", True), ("Kommunal", True),
                                  ("Ofis xarajatlari", True), ("Ish haqi", True), ("Soliqlar", True),
                                  ("Qarz qaytarish", False), ("Ta'sischi olib chiqishi", False)]:
                ExpenseCategory.objects.create(name=name, affects_profit=affects)
        from apps.crm.models import CounterpartyGroup, CounterpartyStatus

        if not CounterpartyGroup.objects.exists():
            for name, color in [("Mijozlar", "#2563eb"), ("Yetkazuvchilar", "#7c3aed"), ("Dilerlar", "#059669")]:
                CounterpartyGroup.objects.create(name=name, color=color)
        if not CounterpartyStatus.objects.exists():
            for pos, (name, color) in enumerate([("Yangi", "#f59e0b"), ("Muzokara", "#3b82f6"),
                                                 ("Doimiy mijoz", "#10b981"), ("Rad etgan", "#6b7280")]):
                CounterpartyStatus.objects.create(name=name, color=color, position=pos)
        if not ExchangeRate.objects.exists():
            last = ExchangeRate.all_objects.order_by("-date").first()
            if last:
                ExchangeRate.objects.create(date=timezone.localdate(), usd_uzs=last.usd_uzs, source="boshlang'ich")
    return main


@transaction.atomic
def register_company(*, company_name, full_name, phone, username, password, email=""):
    company = Company.objects.create(name=company_name, phone=phone, email=email, director=full_name)
    bootstrap_company(company)
    with tenant_context(company):
        from apps.hr.models import Employee

        parts = full_name.split(" ", 1)
        owner = User(username=username, company=company, is_owner=True, phone=phone, email=email,
                     first_name=parts[0], last_name=parts[1] if len(parts) > 1 else "",
                     role=Role.objects.get(code="admin"))
        owner.set_password(password)
        owner.save()
        main = Branch.objects.get(is_main=True)
        Employee.objects.create(full_name=full_name, user=owner, position="Rahbar", phone=phone, branch=main,
                                hired_at=timezone.localdate())
    return company, owner

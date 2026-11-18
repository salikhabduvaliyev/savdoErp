"""Barcha kompaniyalar uchun CBU kurslarini yangilash (kuniga bir marta rejalashtirilgan vazifa sifatida)."""
from django.core.management.base import BaseCommand

from apps.core.currency import update_rates
from apps.core.models import Company
from apps.core.tenancy import tenant_context


class Command(BaseCommand):
    help = "CBU'dan valyuta kurslarini yangilaydi (auto_update yoqilgan valyutalar)"

    def handle(self, *args, **opts):
        for company in Company.objects.all():
            with tenant_context(company):
                res = update_rates(force=True)
            msg = ", ".join(f"{r['code']}={r['rate']}" for r in res["updated"]) or "o'zgarish yo'q"
            self.stdout.write(f"{company.name}: {msg}" + (f" | xato: {'; '.join(res['errors'])}" if res["errors"] else ""))

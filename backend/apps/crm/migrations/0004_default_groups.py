"""Har kompaniyaga standart guruh va holatlar; mavjud kontragentlarni guruhlash."""
from django.db import migrations


def forward(apps, schema_editor):
    Company = apps.get_model("core", "Company")
    Group = apps.get_model("crm", "CounterpartyGroup")
    Status = apps.get_model("crm", "CounterpartyStatus")
    Cp = apps.get_model("crm", "Counterparty")
    for c in Company.objects.all():
        groups = {}
        for name, color in [("Mijozlar", "#2563eb"), ("Yetkazuvchilar", "#7c3aed"), ("Dilerlar", "#059669")]:
            groups[name], _ = Group.objects.get_or_create(company=c, name=name, defaults={"color": color})
        if not Status.objects.filter(company=c).exists():
            for pos, (name, color) in enumerate([("Yangi", "#f59e0b"), ("Muzokara", "#3b82f6"),
                                                 ("Doimiy mijoz", "#10b981"), ("Rad etgan", "#6b7280")]):
                Status.objects.create(company=c, name=name, color=color, position=pos)
        for cp in Cp.objects.filter(company=c):
            if cp.is_client:
                cp.groups.add(groups["Mijozlar"])
            if cp.is_supplier:
                cp.groups.add(groups["Yetkazuvchilar"])


class Migration(migrations.Migration):
    dependencies = [("crm", "0003_counterparty_code_counterparty_extra_and_more"), ("core", "0002_customfield")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]

"""Mavjud kompaniyalar uchun valyutalar ma'lumotnomasi: so'm (asosiy) va USD."""
from django.db import migrations

DEFAULTS = [("UZS", "O'zbek so'mi", "so'm", True, False, 0), ("USD", "AQSh dollari", "$", False, True, 1)]


def forwards(apps, schema_editor):
    Company = apps.get_model("core", "Company")
    CurrencyDef = apps.get_model("core", "CurrencyDef")
    for company in Company.objects.all():
        for code, name, symbol, is_base, auto, pos in DEFAULTS:
            CurrencyDef.objects.get_or_create(company=company, code=code, defaults={
                "name": name, "symbol": symbol, "is_base": is_base, "auto_update": auto, "position": pos})


class Migration(migrations.Migration):
    dependencies = [("core", "0003_currencydef_alter_exchangerate_options_and_more")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

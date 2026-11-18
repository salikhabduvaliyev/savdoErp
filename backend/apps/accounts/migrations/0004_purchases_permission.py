"""Yangi "Xaridlar" moduli: mavjud rollarga Ombor huquqlari nusxa qilinadi."""
from django.db import migrations


def forwards(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    for role in Role.objects.all():
        perms = dict(role.permissions or {})
        if "purchases" not in perms:
            wh = perms.get("warehouse")
            perms["purchases"] = dict(wh) if isinstance(wh, dict) else wh or {}
            role.permissions = perms
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_user_preferences")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

"""Eski (buyurtmaga bog'langan) bosqich topshiriqlarini ishlab chiqarish topshiriqlariga guruhlash."""
from django.db import migrations
from django.utils import timezone


def forward(apps, schema_editor):
    Task = apps.get_model("production", "ProductionTask")
    Job = apps.get_model("production", "ProductionJob")
    numbers = {}
    order_ids = Task.objects.filter(job__isnull=True, order__isnull=False).values_list("order_id", flat=True).distinct()
    Order = apps.get_model("orders", "Order")
    for order in Order.objects.filter(id__in=list(order_ids)).order_by("date", "id"):
        n = numbers.get(order.company_id) or (Job.objects.filter(company_id=order.company_id).order_by("-number")
                                              .values_list("number", flat=True).first() or 0)
        n += 1
        numbers[order.company_id] = n
        tasks = list(Task.objects.filter(order=order, job__isnull=True).select_related("department").order_by("department__sequence", "id"))
        statuses = {t.status for t in tasks}
        status = "done" if statuses == {"done"} else ("in_progress" if statuses - {"waiting"} else "new")
        job = Job.objects.create(company_id=order.company_id, number=n, date=order.date, branch_id=order.branch_id,
                                 order=order, qty=order.volume or 1, plan_start=order.production_date,
                                 plan_end=order.plan_date, status=status,
                                 finished_at=timezone.now() if status == "done" else None)
        for pos, t in enumerate(tasks):
            t.job = job
            t.position = pos
            t.save(update_fields=["job", "position"])


class Migration(migrations.Migration):
    dependencies = [("production", "0003_alter_productiontask_options_operation_description_and_more"),
                    ("orders", "0003_order_extra")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]

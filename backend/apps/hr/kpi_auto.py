"""KPI faktini avtomatik hisoblash: shablon `source` bo'yicha xodim (yoki bo'lim) ning oy natijasi.

Manbalar:
  manual        — qo'lda kiritiladi
  sales_amount  — yakunlangan sotuvlar summasi (sotuvchi = xodim foydalanuvchisi), so'mda
  orders_amount — qabul qilingan buyurtmalar summasi (menejer = xodim), so'mda
  piece_amount  — ishbay haq summasi
  done_qty      — bajarilgan bosqichlar miqdori
  on_time_pct   — muddatida topshirilgan buyurtmalar ulushi, %
  defect_pct    — brak ulushi (brak / bajarilgan), %
Birlik "mln" bilan boshlansa summa millionga bo'linadi.
"""
from decimal import Decimal

from django.db.models import F, Q, Sum

ZERO = Decimal("0")
SOURCES = [
    ("manual", "Qo'lda kiritiladi"),
    ("sales_amount", "Sotuvlar summasi (sotuvchi)"),
    ("orders_amount", "Buyurtmalar summasi (menejer)"),
    ("piece_amount", "Ishbay haq summasi"),
    ("done_qty", "Bajarilgan ish hajmi (bosqichlar)"),
    ("on_time_pct", "Muddatida topshirish, %"),
    ("defect_pct", "Brak ulushi, %"),
]


def _employees(employee=None, department=None):
    from .models import Employee

    if employee is not None:
        return [employee]
    return list(Employee.objects.filter(department=department, is_active=True))


def _to_uzs(amount, cur, day):
    from apps.core.money import RateNotFound, convert

    try:
        return convert(Decimal(amount or 0), cur, "UZS", day)
    except RateNotFound:
        return Decimal(amount or 0) if cur == "UZS" else ZERO


def compute_fact(template, month, employee=None, department=None):
    """Oy uchun fakt (Decimal) yoki None — qo'lda kiritiladigan shablon."""
    from apps.orders.models import Order
    from apps.production.models import StageCompletion
    from apps.sales.models import Sale

    from .models import PieceworkEntry
    from .services import month_range

    src = getattr(template, "source", "manual") or "manual"
    if src == "manual":
        return None
    start, end = month_range(month)
    emps = _employees(employee, department)
    users = [e.user_id for e in emps if e.user_id]
    emp_ids = [e.id for e in emps]
    val = ZERO

    if src == "sales_amount":
        for s in Sale.objects.filter(status=Sale.Status.COMPLETED, date__gte=start, date__lt=end, seller_id__in=users).prefetch_related("items"):
            val += _to_uzs(s.total, s.currency, s.date)
    elif src == "orders_amount":
        for o in Order.objects.filter(date__gte=start, date__lt=end, manager_id__in=users).exclude(status=Order.Status.CANCELLED):
            val += _to_uzs(o.amount, o.currency, o.date)
    elif src == "piece_amount":
        val = PieceworkEntry.objects.filter(employee_id__in=emp_ids, date__gte=start, date__lt=end).aggregate(s=Sum("amount"))["s"] or ZERO
    elif src == "done_qty":
        qs = StageCompletion.objects.filter(date__gte=start, date__lt=end)
        qs = qs.filter(employee_id__in=emp_ids) if employee is not None else qs.filter(Q(employee_id__in=emp_ids) | Q(task__department=department))
        val = qs.aggregate(s=Sum("qty"))["s"] or ZERO
    elif src == "on_time_pct":
        qs = Order.objects.filter(status=Order.Status.DELIVERED, delivered_at__gte=start, delivered_at__lt=end)
        if users:
            qs = qs.filter(manager_id__in=users)
        total = qs.count()
        val = Decimal(qs.filter(delivered_at__lte=F("plan_date")).count() * 100) / total if total else ZERO
    elif src == "defect_pct":
        qs = StageCompletion.objects.filter(date__gte=start, date__lt=end)
        qs = qs.filter(employee_id__in=emp_ids) if employee is not None else qs.filter(Q(employee_id__in=emp_ids) | Q(task__department=department))
        agg = qs.aggregate(d=Sum("defect_qty"), q=Sum("qty"))
        val = (Decimal(agg["d"] or 0) * 100 / Decimal(agg["q"])) if agg["q"] else ZERO

    if src in ("sales_amount", "orders_amount", "piece_amount") and (template.unit or "").lower().startswith("mln"):
        val = val / Decimal("1000000")
    return Decimal(val).quantize(Decimal("0.001"))


def refresh_month(month):
    """Oy natijalarining avtomatik faktlarini yangilash."""
    from .models import KpiResult

    n = 0
    for r in KpiResult.objects.filter(month=month).select_related("template", "employee"):
        fact = compute_fact(r.template, month, employee=r.employee, department=r.department_id if not r.employee_id else None)
        if fact is not None and fact != r.fact:
            r.fact = fact
            r.save(update_fields=["fact", "updated_at"])
            n += 1
    return n

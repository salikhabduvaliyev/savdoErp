"""Oylik vedomost: hisoblangan + KPI bonus − avans/ushlanma.

Maketdagi muammo: kartochkada "Jami 13 000 000", jadvalda "13 400 000".
Yechim — kartochkalar va jadval jami bitta funksiyadan (payroll) olinadi.
"""
from decimal import Decimal

from django.db.models import Sum

from apps.core.money import q2

from .models import Employee, KpiResult, PayrollAdjustment, PieceworkEntry, Timesheet

ZERO = Decimal("0")


def month_range(month):
    start = month.replace(day=1)
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1))
    return start, end


def employee_kpi_coefficient(employee, month):
    """Xodimning shaxsiy KPI'lari, bo'lmasa bo'lim KPI'lari koeffitsiyentlari o'rtachasi."""
    results = list(KpiResult.objects.filter(month=month, employee=employee).select_related("template"))
    if not results and employee.department_id:
        results = list(
            KpiResult.objects.filter(month=month, employee__isnull=True, department=employee.department_id).select_related("template")
        )
    if not results:
        return None
    return sum((r.coefficient for r in results), ZERO) / len(results)


def payroll(month):
    start, end = month_range(month)
    rows = []
    totals = {"accrued": ZERO, "bonus": ZERO, "advance": ZERO, "deduction": ZERO, "paid": ZERO, "net": ZERO}
    for emp in Employee.objects.filter(is_active=True).select_related("department"):
        ts = Timesheet.objects.filter(employee=emp, month=start).first()
        days = ts.days_worked if ts else 0
        norm = ts.working_days if ts else 22
        piece = PieceworkEntry.objects.filter(employee=emp, date__gte=start, date__lt=end).aggregate(s=Sum("amount"))["s"] or ZERO

        if emp.pay_system == Employee.PaySystem.PIECE:
            accrued = piece
        else:
            accrued = (emp.base_salary * days / norm) if norm else ZERO

        coef = employee_kpi_coefficient(emp, start)
        kpis = [{"name": r.template.name, "plan": str(r.plan), "fact": str(r.fact), "unit": r.template.unit,
                 "pct": str(r.achievement_pct)} for r in KpiResult.objects.filter(month=start, employee=emp).select_related("template")]
        bonus = emp.kpi_bonus_base * coef if coef is not None else ZERO
        adj = {
            k: PayrollAdjustment.objects.filter(employee=emp, month=start, kind=k).aggregate(s=Sum("amount"))["s"] or ZERO
            for k in PayrollAdjustment.Kind.values
        }
        bonus += adj["bonus"]
        from apps.finance.models import Transaction

        paid = Transaction.objects.filter(kind=Transaction.Kind.SALARY, employee=emp, date__gte=start, date__lt=end) \
            .aggregate(s=Sum("amount"))["s"] or ZERO  # kassadan to'langan (so'mda yuritiladi)
        net = accrued + bonus - adj["advance"] - adj["deduction"] - paid
        row = {
            "employee": emp.id, "name": emp.full_name,
            "department": emp.department.name if emp.department else None,
            "pay_system": emp.pay_system, "pay_system_display": emp.get_pay_system_display(),
            "days": days, "accrued": q2(accrued), "kpi_coefficient": str(coef) if coef is not None else None, "kpi": kpis,
            "bonus": q2(bonus), "advance": q2(adj["advance"]), "deduction": q2(adj["deduction"]), "paid": q2(paid), "net": q2(net),
        }
        for k in totals:
            totals[k] += row[k]
        rows.append(row)
    for r in rows:
        for k in totals:
            r[k] = str(r[k])
    return {
        "month": start.isoformat(),
        "employees": len(rows),
        "rows": rows,
        "totals": {k: str(q2(v)) for k, v in totals.items()},
        "currency": "UZS",
    }

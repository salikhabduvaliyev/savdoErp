"""Direktor va ishlab chiqarish dashboardlari.

Rentabellik qoidasi (maketda noaniq edi): foyda har bir buyurtma bo'yicha
buyurtma valyutasida hisoblanadi, so'ng buyurtma valyutasi bo'yicha guruhlanadi.
Ya'ni "so'm" ustuni — so'mdagi buyurtmalar, "USD" — dollar buyurtmalar.
Rentabellik = foyda / tushum (marja).
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, F, Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import module_perm
from apps.core.models import SystemSettings
from apps.core.money import MoneyBag, q2
from apps.finance import services as fin
from apps.orders.models import Order
from apps.orders.services import order_costing
from apps.production.models import Department, ProductionTask
from apps.warehouse.models import StockMove

ZERO = Decimal("0")


def _pct(a, b):
    return float(round(a / b * 100, 1)) if b else None


def _month_start(d, back=0):
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


@api_view(["GET"])
@permission_classes([module_perm("dashboard")])
def director(request):
    today = timezone.localdate()
    df = request.query_params.get("date_from")
    dt = request.query_params.get("date_to")
    date_from = date.fromisoformat(df) if df else today.replace(day=1)
    date_to = date.fromisoformat(dt) if dt else today

    chart_from = _month_start(today, 5)
    orders = list(
        Order.objects.filter(date__gte=min(date_from, chart_from), date__lte=max(date_to, today))
        .exclude(status=Order.Status.CANCELLED)
        .select_related("client")
    )
    revenue, cost = MoneyBag(), MoneyBag()
    monthly = defaultdict(lambda: {"revenue": MoneyBag(), "profit": MoneyBag()})
    order_profits = []
    for o in orders:
        c = order_costing(o)
        o_cost, o_profit = Decimal(c["cost"]), Decimal(c["profit"])
        if date_from <= o.date <= date_to:
            revenue.add(o.amount, o.currency)
            cost.add(o_cost, o.currency)
            order_profits.append({"id": o.id, "number": o.number, "client": o.client.name,
                                  "currency": o.currency, "profit": str(q2(o_profit))})
        if o.date >= chart_from:
            key = o.date.strftime("%Y-%m")
            monthly[key]["revenue"].add(o.amount, o.currency)
            monthly[key]["profit"].add(o_profit, o.currency)
    from apps.sales.services import sales_revenue_cost

    s_rev, s_cost = sales_revenue_cost(date_from, date_to)
    revenue, cost = revenue + s_rev, cost + s_cost
    profit = revenue - cost
    margin = {cur: _pct(profit[cur], revenue[cur]) for cur in ("UZS", "USD")}
    worst = sorted([p for p in order_profits if Decimal(p["profit"]) < 0], key=lambda p: Decimal(p["profit"]))[:5]

    months = []
    for i in range(5, -1, -1):
        key = _month_start(today, i).strftime("%Y-%m")
        months.append({"month": key, "revenue": monthly[key]["revenue"].as_dict(), "profit": monthly[key]["profit"].as_dict()})

    statuses = {row["status"]: row["n"] for row in Order.objects.values("status").annotate(n=Count("id"))}
    return Response({
        "period": {"from": date_from, "to": date_to},
        "revenue": revenue.as_dict(), "cost": cost.as_dict(), "profit": profit.as_dict(), "margin_pct": margin,
        "monthly": months,
        "worst_orders": worst,
        "debts": {"clients": fin.client_debts()["total"], "suppliers": fin.supplier_debts()["total"]},
        "statuses": [{"status": v, "label": l, "count": statuses.get(v, 0)} for v, l in Order.Status.choices],
        "overdue_orders": Order.objects.filter(plan_date__lt=today).exclude(status__in=Order.CLOSED_STATUSES).count(),
    })


@api_view(["GET"])
@permission_classes([module_perm(("dashboard", "production"))])
def production(request):
    today = timezone.localdate()
    since = today - timedelta(days=30)

    todays = ProductionTask.objects.filter(planned_date=today).aggregate(p=Sum("plan_qty"), d=Sum("done_qty"))
    delivered = Order.objects.filter(status=Order.Status.DELIVERED, delivered_at__gte=since)
    on_time = delivered.filter(delivered_at__lte=F("plan_date")).count()
    recent = ProductionTask.objects.filter(finished_at__date__gte=since).aggregate(d=Sum("done_qty"), b=Sum("defect_qty"))

    departments = []
    for dep in Department.objects.all():
        active = ProductionTask.objects.filter(department=dep).exclude(status=ProductionTask.Status.DONE)
        agg = active.aggregate(p=Sum("plan_qty"), d=Sum("done_qty"))
        departments.append({
            "id": dep.id, "name": dep.name, "queue": active.count(),
            "progress_pct": _pct(agg["d"] or ZERO, agg["p"]) if agg["p"] else 100.0,
        })

    stalled = []
    for t in ProductionTask.objects.filter(status=ProductionTask.Status.BLOCKED).select_related("order__client"):
        stalled.append({"order": t.order_id, "number": t.order.number, "client": t.order.client.name,
                        "reason": t.blocked_reason or "Material yo'q", "kind": "blocked"})
    for o in Order.objects.filter(plan_date__lt=today).exclude(status__in=Order.CLOSED_STATUSES).select_related("client"):
        stalled.append({"order": o.id, "number": o.number, "client": o.client.name,
                        "reason": f"{o.overdue_days} kun kechikkan", "kind": "overdue"})

    # Material sarfi: me'yor (smeta, chiqindi bilan) va haqiqat (ombordan chiqim)
    norm, fact, names = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO), {}
    for o in Order.objects.filter(status__in=[Order.Status.READY, Order.Status.DELIVERED], updated_at__date__gte=today - timedelta(days=90)):
        est = o.active_estimate
        if not est:
            continue
        for m in est.materials.select_related("material"):
            norm[m.material_id] += m.qty_with_waste
            names[m.material_id] = m.material.name
        for mv in StockMove.objects.filter(order=o, type=StockMove.Type.OUT).values("material_id").annotate(s=Sum("qty")):
            fact[mv["material_id"]] += mv["s"]
    consumption = [
        {"material": names[mid], "norm": str(q2(n)), "fact": str(q2(fact[mid])),
         "deviation_pct": _pct(fact[mid] - n, n)}
        for mid, n in norm.items() if n
    ]

    return Response({
        "plan_completion_pct": _pct(todays["d"] or ZERO, todays["p"]) if todays["p"] else None,
        "on_time_pct": _pct(Decimal(on_time), Decimal(delivered.count())),
        "defect_pct": _pct(recent["b"] or ZERO, recent["d"]) if recent["d"] else None,
        "defect_norm_pct": float(SystemSettings.load().defect_norm_pct),
        "departments": departments,
        "stalled": stalled,
        "consumption": consumption,
    })

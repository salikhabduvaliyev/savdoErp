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
from apps.core.money import MoneyBag, convert, q2
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


def _base_sum(bag, base):
    """Ko'p valyutali summani asosiy valyutaga (joriy kurs) — faqat saralash uchun."""
    total = ZERO
    for cur, v in bag.items():
        try:
            total += convert(Decimal(v), cur, base)
        except Exception:  # noqa: BLE001 — kurs yo'q
            total += Decimal(v)
    return total


def _boss_extras(date_from, date_to):
    """Rahbar uchun: eng ko'p sotilgan 5 tovar, eng katta 5 qarzdor, bizning 5 kreditor, kassa, sotuvlar soni."""
    from apps.core.currency import company_base_currency
    from apps.crm.models import Counterparty
    from apps.sales.models import Sale, SaleItem
    from apps.warehouse.models import Material, Stock

    base = company_base_currency()
    # --- eng ko'p sotilgan tovarlar (yakunlangan sotuvlar, davr ichida)
    items = SaleItem.objects.filter(sale__status=Sale.Status.COMPLETED, sale__date__range=(date_from, date_to),
                                    product__isnull=False).values("product_id", "product__name", "product__code",
                                                                  "product__unit", "sale__currency")
    agg = defaultdict(lambda: {"qty": ZERO, "revenue": MoneyBag(), "profit": MoneyBag(), "base": ZERO})
    names = {}
    for r in items.annotate(q=Sum("qty"), a=Sum("amount"), c=Sum("cost_amount")):
        k = r["product_id"]
        names[k] = (r["product__name"], r["product__code"], r["product__unit"])
        g = agg[k]
        g["qty"] += r["q"] or ZERO
        g["revenue"].add(r["a"] or ZERO, r["sale__currency"])
        g["profit"].add((r["a"] or ZERO) - (r["c"] or ZERO), r["sale__currency"])
    for k, g in agg.items():
        g["base"] = _base_sum(g["revenue"].as_dict(), base)
    from apps.production.models import Unit

    units = dict(Unit.choices)
    top_products = [
        {"product": k, "name": names[k][0], "code": names[k][1], "unit": units.get(names[k][2], names[k][2]),
         "qty": str(q2(g["qty"])), "revenue": g["revenue"].as_dict(), "profit": g["profit"].as_dict()}
        for k, g in sorted(agg.items(), key=lambda kv: -kv[1]["base"])[:5]
    ]

    def top(rows, key):
        out = []
        for r in rows:
            debt = {c: v for c, v in r["debt"].items() if Decimal(v) > 0}
            if debt:
                out.append({"id": r[key], "name": r["name"], "debt": debt, "_s": _base_sum(debt, base)})
        out.sort(key=lambda x: -x["_s"])
        return [{k: v for k, v in x.items() if k != "_s"} for x in out[:5]]

    cd, sd = fin.client_debts(), fin.supplier_debts()
    sales = Sale.objects.filter(status=Sale.Status.COMPLETED, date__range=(date_from, date_to))
    sales_count = sales.count()
    low_stock = sum(1 for m in Material.objects.filter(min_qty__gt=0, is_active=True)
                    if sum((st.qty for st in Stock.objects.filter(material=m)), ZERO) <= m.min_qty)
    return {
        "base_currency": base,
        "top_products": top_products,
        "top_debtors": top(cd["rows"], "client"),
        "top_creditors": top(sd["rows"], "supplier"),
        "cash": fin.balances()["total"],
        "kpi": {
            "orders": Order.objects.filter(date__range=(date_from, date_to)).exclude(status=Order.Status.CANCELLED).count(),
            "sales": sales_count,
            "new_clients": Counterparty.objects.filter(created_at__date__range=(date_from, date_to)).count(),
            "low_stock": low_stock,
        },
    }


@api_view(["GET"])
@permission_classes([module_perm("dashboard")])
def director(request):
    today = timezone.localdate()
    df = request.query_params.get("date_from")
    dt = request.query_params.get("date_to")
    date_from = date.fromisoformat(df) if df else today.replace(day=1)
    date_to = date.fromisoformat(dt) if dt else today

    chart_from = _month_start(today, 5)
    from apps.orders.services import with_costing

    orders = list(with_costing(
        Order.objects.filter(date__gte=min(date_from, chart_from), date__lte=max(date_to, today))
        .exclude(status=Order.Status.CANCELLED)
        .select_related("client")
    ))
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

    from apps.orders.models import OrderState, ensure_order_states

    ensure_order_states()
    st_counts = {row["state"]: row["n"] for row in Order.objects.values("state").annotate(n=Count("id"))}
    extra = _boss_extras(date_from, date_to)
    return Response({
        **extra,
        "period": {"from": date_from, "to": date_to},
        "revenue": revenue.as_dict(), "cost": cost.as_dict(), "profit": profit.as_dict(), "margin_pct": margin,
        "monthly": months,
        "worst_orders": worst,
        "debts": {"clients": fin.client_debts()["total"], "suppliers": fin.supplier_debts()["total"]},
        "statuses": [{"status": st.kind, "label": st.name, "color": st.color, "count": st_counts.get(st.id, 0)}
                     for st in OrderState.objects.all()],
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

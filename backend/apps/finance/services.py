from collections import defaultdict
from decimal import Decimal

from django.db.models import F, Q, Sum

from apps.core.money import MoneyBag, q2
from apps.core.tenancy import current_branch_id

from .models import Account, Transaction

ZERO = Decimal("0")


def account_balance(account: Account, until=None) -> Decimal:
    qs = account.transactions.all()
    if until:
        qs = qs.filter(date__lte=until)
    agg = qs.aggregate(
        inc=Sum("amount", filter=Q(direction=Transaction.Direction.IN)),
        out=Sum("amount", filter=Q(direction=Transaction.Direction.OUT)),
    )
    return account.opening_balance + (agg["inc"] or ZERO) - (agg["out"] or ZERO)


def balances():
    rows, bag = [], MoneyBag()
    qs = Account.objects.filter(is_active=True)
    bid = current_branch_id()
    if bid:
        qs = qs.filter(Q(branch_id=bid) | Q(branch__isnull=True))
    for acc in qs:
        bal = account_balance(acc)
        bag.add(bal, acc.currency)
        rows.append({"id": acc.id, "name": acc.name, "kind": acc.kind, "currency": acc.currency, "balance": str(q2(bal))})
    return {"accounts": rows, "total": bag.as_dict()}


def client_debts():
    """Mijozlar qarzi (debitor), valyuta bo'yicha alohida:
    sotilmagan buyurtmalar qarzi + yakunlangan sotuvlar qarzi − hujjatga biriktirilmagan to'lovlar (avans).
    """
    from apps.orders.models import Order
    from apps.orders.views import with_paid
    from apps.sales.models import Sale
    from apps.sales.views import with_totals

    bid = current_branch_id()
    per_client = defaultdict(MoneyBag)
    names = {}
    orders = with_paid(Order.objects.exclude(status=Order.Status.CANCELLED).select_related("client"))
    sales = with_totals(Sale.objects.filter(status=Sale.Status.COMPLETED).select_related("client"))
    if bid:
        orders, sales = orders.filter(branch_id=bid), sales.filter(branch_id=bid)
    for doc in list(orders) + list(sales):
        debt = doc.debt
        if debt:
            per_client[doc.client_id].add(debt, doc.currency)
            names[doc.client_id] = doc.client.name
    free = Transaction.objects.filter(kind=Transaction.Kind.CLIENT_PAYMENT, order__isnull=True, sale__isnull=True,
                                      client__isnull=False)
    if bid:
        free = free.filter(account__branch_id=bid)
    for row in free.values("client_id", "client__name", "currency").annotate(s=Sum("amount")):
        per_client[row["client_id"]].add(-row["s"], row["currency"])
        names[row["client_id"]] = row["client__name"]
    total = MoneyBag()
    rows = []
    for cid, bag in per_client.items():
        if all(v == 0 for _, v in bag.items()):
            continue
        total = total + bag
        rows.append({"client": cid, "name": names[cid], "debt": bag.as_dict()})
    rows.sort(key=lambda r: -Decimal(r["debt"]["UZS"]) - Decimal(r["debt"]["USD"]) * 10000)
    return {"rows": rows, "total": total.as_dict()}


def supplier_debts():
    """Yetkazuvchilarga qarz (kreditor): ombor kirimlari − to'lovlar, valyuta bo'yicha."""
    from apps.warehouse.models import StockMove

    per_supplier = defaultdict(MoneyBag)
    names = {}
    for m in (
        StockMove.objects.filter(type=StockMove.Type.IN, supplier__isnull=False)
        .values("supplier_id", "supplier__name", "currency")
        .annotate(total=Sum(F("qty") * F("price")))
    ):
        per_supplier[m["supplier_id"]].add(m["total"], m["currency"])
        names[m["supplier_id"]] = m["supplier__name"]
    for t in (
        Transaction.objects.filter(kind=Transaction.Kind.SUPPLIER_PAYMENT)
        .values("supplier_id", "supplier__name", "currency")
        .annotate(total=Sum("amount"))
    ):
        per_supplier[t["supplier_id"]].add(-t["total"], t["currency"])
        names[t["supplier_id"]] = t["supplier__name"]
    total = MoneyBag()
    rows = []
    for sid, bag in per_supplier.items():
        total = total + bag
        rows.append({"supplier": sid, "name": names[sid], "debt": bag.as_dict()})
    return {"rows": rows, "total": total.as_dict()}


def profit_and_loss(date_from, date_to):
    """Foyda va zarar (valyuta bo'yicha alohida).

    Buyurtmalar foydasi — buyurtma valyutasida (tushum − tannarx);
    ustama xarajatlar (buyurtmaga biriktirilmagan) — alohida qator.
    """
    from apps.orders.models import Order
    from apps.orders.services import order_costing

    revenue, cost = MoneyBag(), MoneyBag()
    for o in Order.objects.filter(date__range=(date_from, date_to)).exclude(status=Order.Status.CANCELLED):
        c = order_costing(o)
        revenue.add(o.amount, o.currency)
        cost.add(Decimal(c["cost"]), o.currency)
    from apps.sales.services import sales_revenue_cost

    s_rev, s_cost = sales_revenue_cost(date_from, date_to)
    revenue, cost = revenue + s_rev, cost + s_cost
    overhead = MoneyBag()
    for row in (
        Transaction.objects.filter(
            date__range=(date_from, date_to), direction=Transaction.Direction.OUT, order__isnull=True,
            kind__in=[Transaction.Kind.EXPENSE, Transaction.Kind.SALARY],
        ).exclude(category__affects_profit=False)
        .values("currency")
        .annotate(s=Sum("amount"))
    ):
        overhead.add(row["s"], row["currency"])
    gross = revenue - cost
    net = gross - overhead
    return {
        "revenue": revenue.as_dict(), "cost": cost.as_dict(), "gross_profit": gross.as_dict(),
        "overhead": overhead.as_dict(), "net_profit": net.as_dict(),
    }


def cash_flow(date_from, date_to):
    rows = defaultdict(lambda: {"in": MoneyBag(), "out": MoneyBag()})
    for t in Transaction.objects.filter(date__range=(date_from, date_to)).values("date", "direction", "currency", "amount"):
        key = t["date"].strftime("%Y-%m")
        rows[key][t["direction"]].add(t["amount"], t["currency"])
    return [
        {"month": k, "in": v["in"].as_dict(), "out": v["out"].as_dict(), "net": (v["in"] - v["out"]).as_dict()}
        for k, v in sorted(rows.items())
    ]

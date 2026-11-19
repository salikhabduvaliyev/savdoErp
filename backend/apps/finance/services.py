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
    # mijoz qaytarishlari qarzni kamaytiradi
    from apps.warehouse.models import StockDoc

    for d in StockDoc.objects.filter(type="sales_return", posted=True, counterparty__isnull=False)             .select_related("counterparty").prefetch_related("items"):
        per_client[d.counterparty_id].add(-d.total, d.currency)
        names[d.counterparty_id] = d.counterparty.name
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

    from apps.warehouse.models import StockDoc

    per_supplier = defaultdict(MoneyBag)
    names = {}
    # hujjatsiz (eski) kirimlar — material valyutasida
    for m in (
        StockMove.objects.filter(type=StockMove.Type.IN, supplier__isnull=False, doc__isnull=True)
        .values("supplier_id", "supplier__name", "currency")
        .annotate(total=Sum(F("qty") * F("price")))
    ):
        per_supplier[m["supplier_id"]].add(m["total"], m["currency"])
        names[m["supplier_id"]] = m["supplier__name"]
    # qabul qilish (+) va yetkazuvchiga qaytarish (−) — hujjat valyutasida
    for d in StockDoc.objects.filter(type__in=["supply", "purchase_return"], posted=True, counterparty__isnull=False)             .select_related("counterparty").prefetch_related("items"):
        sign = 1 if d.type == "supply" else -1
        per_supplier[d.counterparty_id].add(sign * d.total, d.currency)
        names[d.counterparty_id] = d.counterparty.name
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
    from apps.orders.services import with_costing

    for o in with_costing(Order.objects.filter(date__range=(date_from, date_to)).exclude(status=Order.Status.CANCELLED)):
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


def pnl_report(date_from, date_to, currency="UZS"):
    """Foyda va zarar — MoySklad tuzilmasida, bitta hisobot valyutasida.

    Har bir summa o'z sanasidagi kurs bo'yicha `currency` ga aylantiriladi (aniq, kuzatiladigan aylantirish).
    Qatorlar: Tushum → Tannarx → Yalpi foyda → Operatsion xarajatlar (moddalar bo'yicha, hisobdan chiqarishlar
    bilan) → Operatsion foyda → Boshqa daromadlar → Sof foyda.
    """
    from apps.core.money import RateNotFound, convert
    from apps.orders.models import Order
    from apps.orders.services import order_costing
    from apps.sales.models import Sale
    from apps.warehouse.documents import doc_cost
    from apps.warehouse.models import StockDoc, StockMove

    warnings = set()

    def cv(amount, cur, day):
        try:
            return convert(Decimal(amount or 0), cur, currency, day)
        except RateNotFound as e:
            warnings.add(str(e))
            return Decimal("0")

    rev = {"orders": Decimal("0"), "sales": Decimal("0"), "returns": Decimal("0")}
    cost = {"orders": Decimal("0"), "sales": Decimal("0"), "returns": Decimal("0")}
    from apps.orders.services import with_costing

    for o in with_costing(Order.objects.filter(date__range=(date_from, date_to)).exclude(status=Order.Status.CANCELLED)):
        c = order_costing(o)
        rev["orders"] += cv(o.amount, o.currency, o.date)
        cost["orders"] += cv(c["cost"], o.currency, o.date)
    for sale in Sale.objects.filter(status=Sale.Status.COMPLETED, date__range=(date_from, date_to)).prefetch_related("items"):
        lines = [i for i in sale.items.all() if not i.order_id]
        if not lines:
            continue
        rev["sales"] += cv(sum((i.amount for i in lines), Decimal("0")) - (sale.discount or 0), sale.currency, sale.date)
        cost["sales"] += cv(sum((i.cost_amount for i in lines), Decimal("0")), sale.currency, sale.date)
    for d in StockDoc.objects.filter(type="sales_return", posted=True, date__range=(date_from, date_to)).prefetch_related("items", "moves"):
        rev["returns"] -= cv(d.total, d.currency, d.date)
        cost["returns"] -= cv(doc_cost(d), d.currency, d.date)

    # operatsion xarajatlar: buyurtmaga biriktirilmagan, foydaga ta'sir qiladigan
    opex = defaultdict(lambda: Decimal("0"))
    for t in (Transaction.objects.filter(date__range=(date_from, date_to), direction=Transaction.Direction.OUT,
                                         order__isnull=True, kind__in=[Transaction.Kind.EXPENSE, Transaction.Kind.SALARY])
              .exclude(category__affects_profit=False).select_related("category")):
        name = t.category.name if t.category else ("Ish haqi" if t.kind == Transaction.Kind.SALARY else "Boshqa xarajatlar")
        opex[name] += cv(t.amount, t.currency, t.date)
    # hisobdan chiqarishlar (Списания) va inventarizatsiya kamomadi — tannarx bo'yicha
    losses = Decimal("0")
    for mv in StockMove.objects.filter(date__range=(date_from, date_to), doc__type="loss"):
        losses += cv(Decimal(mv.qty) * Decimal(mv.price), mv.currency, mv.date)
    surplus = Decimal("0")
    for mv in StockMove.objects.filter(date__range=(date_from, date_to), type=StockMove.Type.ADJUST):
        amount = Decimal(mv.qty) * Decimal(mv.price)
        if amount < 0:
            losses += cv(-amount, mv.currency, mv.date)
        else:
            surplus += cv(amount, mv.currency, mv.date)

    other = defaultdict(lambda: Decimal("0"))
    for t in (Transaction.objects.filter(date__range=(date_from, date_to), kind=Transaction.Kind.OTHER_INCOME)
              .exclude(category__affects_profit=False).select_related("category")):
        other[t.category.name if t.category else "Boshqa daromadlar"] += cv(t.amount, t.currency, t.date)
    if surplus:
        other["Inventarizatsiya ortiqchasi"] += surplus

    q = lambda v: str(Decimal(v).quantize(Decimal("0.01")))  # noqa: E731
    revenue = sum(rev.values(), Decimal("0"))
    cogs = sum(cost.values(), Decimal("0"))
    gross = revenue - cogs
    opex_rows = sorted(opex.items(), key=lambda kv: -kv[1])
    opex_total = sum(opex.values(), Decimal("0")) + losses
    operating = gross - opex_total
    other_total = sum(other.values(), Decimal("0"))
    net = operating + other_total

    rows = [
        {"key": "revenue", "label": "Tushum", "amount": q(revenue), "level": 0, "bold": True},
        {"key": "rev_orders", "label": "Buyurtmalar", "amount": q(rev["orders"]), "level": 1},
        {"key": "rev_sales", "label": "Sotuvlar (tovarlar)", "amount": q(rev["sales"]), "level": 1},
        {"key": "rev_returns", "label": "Mijoz qaytarishlari", "amount": q(rev["returns"]), "level": 1},
        {"key": "cogs", "label": "Tannarx", "amount": q(cogs), "level": 0},
        {"key": "gross", "label": "Yalpi foyda", "amount": q(gross), "level": 0, "bold": True, "total": True},
        {"key": "opex", "label": "Operatsion xarajatlar", "amount": q(opex_total), "level": 0},
        {"key": "losses", "label": "Hisobdan chiqarishlar", "amount": q(losses), "level": 1},
        *[{"key": f"opex:{n}", "label": n, "amount": q(v), "level": 1} for n, v in opex_rows],
        {"key": "operating", "label": "Operatsion foyda", "amount": q(operating), "level": 0, "bold": True, "total": True},
        {"key": "other", "label": "Boshqa daromadlar", "amount": q(other_total), "level": 0},
        *[{"key": f"other:{n}", "label": n, "amount": q(v), "level": 1} for n, v in sorted(other.items())],
        {"key": "net", "label": "Sof foyda", "amount": q(net), "level": 0, "bold": True, "total": True, "grand": True},
    ]
    margin = (gross / revenue * 100).quantize(Decimal("0.1")) if revenue else None
    net_margin = (net / revenue * 100).quantize(Decimal("0.1")) if revenue else None
    return {"currency": currency, "rows": rows, "gross_margin_pct": str(margin) if margin is not None else None,
            "net_margin_pct": str(net_margin) if net_margin is not None else None, "warnings": sorted(warnings)}

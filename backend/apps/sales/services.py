from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.core.models import Branch, SystemSettings
from apps.core.money import convert
from apps.core.tenancy import current_branch_id

from .models import Sale, SaleItem

ZERO = Decimal("0")


def _branch_id():
    return current_branch_id() or Branch.objects.filter(is_main=True).values_list("id", flat=True).first()


def order_production_pending(order):
    """Buyurtma ishlab chiqarishga berilgan va hali tugallanmagan bo'lsa — tugallanmagan hujjatlar ro'yxati."""
    from apps.production.models import ProductionJob, ProductionOrder

    pending = [f"ishlab chiqarish buyurtmasi №{po.number}" for po in
               order.production_orders.exclude(status__in=[ProductionOrder.Status.CANCELLED, ProductionOrder.Status.DONE])]
    pending += [f"topshiriq №{j.number}" for j in
                order.jobs.exclude(status__in=[ProductionJob.Status.CANCELLED, ProductionJob.Status.DONE])]
    return pending


@transaction.atomic
def sale_from_order(order, user):
    """Tayyor buyurtmadan sotuv qoralamasi (yoki mavjud qoralamani qaytaradi)."""
    from apps.orders.models import Order

    existing = order.sales.exclude(status=Sale.Status.CANCELLED).first()
    if existing:
        return existing, False
    if order.status == Order.Status.CANCELLED:
        raise ValidationError("Bekor qilingan buyurtmani sotib bo'lmaydi")
    pending = order_production_pending(order)
    if pending:
        raise ValidationError(f"Ishlab chiqarish tugallanmagan ({', '.join(pending)}) — avval ishlab chiqarishni yakunlang")
    sale = Sale.objects.create(
        client=order.client, currency=order.currency, order=order, branch_id=order.branch_id or _branch_id(),
        seller=user, created_by=user, note=f"Buyurtma №{order.number} asosida",
        price_type=order.client.price_type,
    )
    items = list(order.items.select_related("product"))
    if items:
        # MoySklad: buyurtma pozitsiyalari jo'natishga ko'chadi; tovarlar ombordan chiqim qilinadi
        for pos, it in enumerate(items):
            SaleItem.objects.create(sale=sale, order=order, product=it.product, name=it.name, unit=it.unit,
                                    qty=it.qty, price=it.price, discount_pct=it.discount_pct, position=pos)
        if not sale.warehouse_id:
            from apps.warehouse.services import default_warehouse

            sale.warehouse = default_warehouse()
            sale.save(update_fields=["warehouse"])
    else:
        SaleItem.objects.create(sale=sale, order=order, name=f"Buyurtma №{order.number}", unit="buyurtma",
                                qty=1, price=order.amount, position=0)
    return sale, True


@transaction.atomic
def sale_from_order_form(order, user, data, complete=True):
    """Buyurtmadan sotuv — formada (buyurtma qiymatlari bilan oldindan to'ldirilgan, o'zgartirilgan) saqlanganda.
    Qoralama yaratilmaydi: sotuv darhol o'tkaziladi (complete=True)."""
    from apps.orders.models import Order

    existing = order.sales.exclude(status=Sale.Status.CANCELLED).first()
    if existing:
        raise ValidationError(f"Bu buyurtma bo'yicha sotuv №{existing.number} allaqachon bor")
    if order.status == Order.Status.CANCELLED:
        raise ValidationError("Bekor qilingan buyurtmani sotib bo'lmaydi")
    pending = order_production_pending(order)
    if pending:
        raise ValidationError(f"Ishlab chiqarish tugallanmagan ({', '.join(pending)}) — avval ishlab chiqarishni yakunlang")
    items = data.pop("items", [])
    if not items:
        raise ValidationError("Sotuvda qatorlar yo'q")
    data.pop("client", None)
    data.pop("currency", None)
    sale = Sale.objects.create(client=order.client, currency=order.currency, order=order,
                               branch_id=order.branch_id or _branch_id(), seller=user, created_by=user, **data)
    for pos, it in enumerate(items):
        SaleItem.objects.create(sale=sale, order=order, position=pos, **it)
    if complete:
        complete_sale(sale)
    return sale


@transaction.atomic
def complete_sale(sale):
    from apps.orders.models import Order
    from apps.warehouse.models import StockMove
    from apps.warehouse.services import post_move

    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.status != Sale.Status.DRAFT:
        raise ValidationError("Faqat qoralama sotuvni yakunlash mumkin")
    items = list(sale.items.select_related("product", "order"))
    if not items:
        raise ValidationError("Sotuvda qatorlar yo'q")
    if sale.total < 0:
        raise ValidationError("Chegirma summadan katta bo'lishi mumkin emas")
    allow_negative = SystemSettings.load().allow_negative_stock
    for it in items:
        if it.product_id and it.product.is_stocked:
            if not sale.warehouse_id:
                raise ValidationError("Tovar sotish uchun omborni tanlang")
            move = post_move(StockMove(
                date=sale.date, type=StockMove.Type.OUT, material=it.product, warehouse=sale.warehouse,
                qty=it.qty, sale=sale, created_by=sale.created_by, note=f"Sotuv №{sale.number}",
            ), allow_negative=allow_negative)
            it.cost_amount = convert(move.amount, move.currency, sale.currency, sale.date).quantize(Decimal("0.01"))
            it.save(update_fields=["cost_amount"])
        elif it.order_id and not it.order.items.exists():
            # eski uslub: butun buyurtma bitta qator — tannarx smetadan
            from apps.orders.services import order_costing

            it.cost_amount = Decimal(order_costing(it.order)["cost"])
            it.save(update_fields=["cost_amount"])
    sale.status = Sale.Status.COMPLETED
    sale.completed_at = timezone.now()
    sale.save(update_fields=["status", "completed_at", "updated_at"])
    if sale.order_id and sale.order.status != Order.Status.DELIVERED:
        sale.order.status = Order.Status.DELIVERED
        sale.order.save()
    return sale


@transaction.atomic
def cancel_sale(sale):
    from apps.orders.models import Order
    from apps.warehouse.models import StockMove
    from apps.warehouse.services import post_move

    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.status == Sale.Status.CANCELLED:
        raise ValidationError("Sotuv allaqachon bekor qilingan")
    if sale.transactions.exists():
        raise ValidationError("Sotuvga to'lov qabul qilingan — avval to'lovni qaytaring (Moliya)")
    if sale.status == Sale.Status.COMPLETED:
        # ombordan chiqqan tovarlarni qaytarish (o'sha tannarx bilan)
        for mv in StockMove.objects.filter(sale=sale, type=StockMove.Type.OUT):
            post_move(StockMove(date=timezone.localdate(), type=StockMove.Type.IN, material=mv.material,
                                warehouse=mv.warehouse, qty=mv.qty, price=mv.price, sale=sale,
                                note=f"Sotuv №{sale.number} bekor qilindi"))
        if sale.order_id and sale.order.status == Order.Status.DELIVERED:
            sale.order.status = Order.Status.READY
            sale.order.delivered_at = None
            sale.order.save()
    sale.status = Sale.Status.CANCELLED
    sale.save(update_fields=["status", "updated_at"])
    return sale


def register_payment(sale, *, account, amount, date=None, description="", user=None):
    from apps.finance.models import Transaction

    if sale.status == Sale.Status.CANCELLED:
        raise ValidationError("Bekor qilingan sotuvga to'lov qabul qilinmaydi")
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError("Summa musbat bo'lishi kerak")
    # Valyuta xatosidan himoya: sotuv valyutasidagi ekvivalent qoldiqdan sezilarli oshmasin
    remaining = sale.total - sale.paid
    in_sale_cur = convert(amount, account.currency, sale.currency, date or timezone.localdate())
    if in_sale_cur > remaining * Decimal("1.01") + Decimal("1"):
        raise ValidationError(
            f"To'lov qoldiqdan katta: {in_sale_cur:,.2f} {sale.currency} > qoldiq {remaining:,.2f} {sale.currency}. "
            f"Hisob valyutasini tekshiring ({account.currency})."
        )
    t = Transaction(date=date or timezone.localdate(), account=account, kind=Transaction.Kind.CLIENT_PAYMENT,
                    amount=amount, sale=sale, client=sale.client, order=sale.order,
                    description=description or f"Sotuv №{sale.number} — to'lov", created_by=user)
    t.full_clean(exclude=["company", "direction", "currency"])
    t.save()
    return t


def sales_revenue_cost(date_from, date_to):
    """Yakunlangan sotuvlarning buyurtmadan tashqari qatorlari (buyurtma tushumi buyurtma bo'yicha hisoblanadi).

    Qaytaradi: (tushum MoneyBag, tannarx MoneyBag), sotuv valyutasi bo'yicha.
    """
    from apps.core.money import MoneyBag

    revenue, cost = MoneyBag(), MoneyBag()
    qs = Sale.objects.filter(status=Sale.Status.COMPLETED, date__range=(date_from, date_to)).prefetch_related("items")
    for sale in qs:
        lines = [i for i in sale.items.all() if not i.order_id]
        if not lines:
            continue
        revenue.add(sum((i.amount for i in lines), ZERO) - (sale.discount or ZERO), sale.currency)
        cost.add(sum((i.cost_amount for i in lines), ZERO), sale.currency)
    # mijoz qaytarishlari: tushum va tannarx kamayadi
    from apps.warehouse.documents import doc_cost
    from apps.warehouse.models import StockDoc

    for d in StockDoc.objects.filter(type="sales_return", posted=True, date__range=(date_from, date_to)).prefetch_related("items", "moves"):
        revenue.add(-d.total, d.currency)
        cost.add(-doc_cost(d), d.currency)
    return revenue, cost


@transaction.atomic
def unpost_sale(sale):
    """O'tkazishni bekor qilish (MoySklad: "Проведено" belgisini olish): ombor harakatlari qaytariladi,
    sotuv qoralamaga aylanadi. To'lovlar saqlanadi."""
    from apps.orders.models import Order
    from apps.warehouse.documents import _reverse
    from apps.warehouse.models import StockMove

    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    if sale.status != Sale.Status.COMPLETED:
        return sale
    if sale.returns.filter(posted=True).exists():
        raise ValidationError("Sotuv bo'yicha mijoz qaytarishi bor — avval qaytarishni bekor qiling")
    allow = SystemSettings.load().allow_negative_stock
    for mv in StockMove.objects.filter(sale=sale).select_related("material", "warehouse").order_by("-id"):
        _reverse(mv, allow)
    sale.items.update(cost_amount=ZERO)
    sale.status = Sale.Status.DRAFT
    sale.completed_at = None
    sale.save(update_fields=["status", "completed_at", "updated_at"])
    if sale.order_id and sale.order.status == Order.Status.DELIVERED:
        sale.order.status = Order.Status.READY
        sale.order.delivered_at = None
        sale.order.save()
    return sale


@transaction.atomic
def delete_sale(sale):
    """O'chirish (MoySklad uslubi — bekor qilish o'rniga): o'tkazilgan bo'lsa avval qaytariladi,
    to'lovlar o'chirilmaydi — mijozning avansi bo'lib qoladi."""
    if sale.returns.exists():
        raise ValidationError("Sotuv bo'yicha mijoz qaytarishi bor — avval qaytarishni o'chiring")
    unpost_sale(sale)
    sale.transactions.update(sale=None)
    sale.delete()


def profitability(date_from, date_to, by="product", currency="UZS", warehouse=None):
    """Foydalilik (MoySklad "Прибыльность"): tovar / mijoz / sotuvchi bo'yicha sotuv va qaytarishlar,
    tannarx, foyda va rentabellik — bitta hisobot valyutasida (sana bo'yicha kurs)."""
    from collections import defaultdict

    from apps.core.money import RateNotFound
    from apps.warehouse.models import StockDoc

    warnings = set()

    def cv(amount, cur, day):
        try:
            return convert(Decimal(amount or 0), cur, currency, day)
        except RateNotFound as e:
            warnings.add(str(e))
            return ZERO

    rows = defaultdict(lambda: {"docs": set(), "qty": ZERO, "revenue": ZERO, "cost": ZERO,
                                "ret_docs": set(), "ret_qty": ZERO, "ret_amount": ZERO, "ret_cost": ZERO})
    meta = {}
    sales = Sale.objects.filter(status=Sale.Status.COMPLETED, date__range=(date_from, date_to)) \
        .select_related("client", "seller").prefetch_related("items__product")
    if warehouse:
        sales = sales.filter(warehouse_id=warehouse)
    for sale in sales:
        items = list(sale.items.all())
        gross = sum((i.amount for i in items), ZERO)
        k = (1 - (sale.discount or ZERO) / gross) if gross else Decimal("1")  # umumiy chegirma qatorlarga bo'linadi
        for it in items:
            if by == "product":
                key = ("p", it.product_id) if it.product_id else ("n", it.name)
                meta.setdefault(key, {"name": it.name if not it.product_id else it.product.name,
                                      "code": it.product.code if it.product_id else "", "unit": it.unit or (it.product.get_unit_display() if it.product_id else "")})
            elif by == "client":
                key = ("c", sale.client_id)
                meta.setdefault(key, {"name": sale.client.name, "code": "", "unit": ""})
            else:
                key = ("s", sale.seller_id)
                meta.setdefault(key, {"name": sale.seller.full_name if sale.seller_id else "—", "code": "", "unit": ""})
            r = rows[key]
            r["docs"].add(sale.id)
            r["qty"] += it.qty
            r["revenue"] += cv(it.amount * k, sale.currency, sale.date)
            r["cost"] += cv(it.cost_amount, sale.currency, sale.date)
    rets = StockDoc.objects.filter(type="sales_return", posted=True, date__range=(date_from, date_to)) \
        .select_related("counterparty", "sale__seller").prefetch_related("items__material", "moves")
    if warehouse:
        rets = rets.filter(warehouse_id=warehouse)
    for d in rets:
        moves = {m.material_id: m for m in d.moves.all()}
        for it in d.items.all():
            if by == "product":
                key = ("p", it.material_id)
                meta.setdefault(key, {"name": it.material.name, "code": it.material.code, "unit": it.material.get_unit_display()})
            elif by == "client":
                key = ("c", d.counterparty_id)
                meta.setdefault(key, {"name": d.counterparty.name if d.counterparty_id else "—", "code": "", "unit": ""})
            else:
                seller = d.sale.seller if d.sale_id else None
                key = ("s", seller.id if seller else None)
                meta.setdefault(key, {"name": seller.full_name if seller else "—", "code": "", "unit": ""})
            r = rows[key]
            r["ret_docs"].add(d.id)
            r["ret_qty"] += it.qty
            r["ret_amount"] += cv(it.amount, d.currency, d.date)
            mv = moves.get(it.material_id)
            if mv is not None:
                r["ret_cost"] += cv(Decimal(it.qty) * Decimal(mv.price), mv.currency, d.date)

    q = lambda v: str(Decimal(v).quantize(Decimal("0.01")))  # noqa: E731
    out = []
    tot = defaultdict(lambda: ZERO)
    for key, r in rows.items():
        revenue = r["revenue"] - r["ret_amount"]
        cost = r["cost"] - r["ret_cost"]
        profit = revenue - cost
        row = {**meta[key], "key": f"{key[0]}:{key[1]}", "docs": len(r["docs"]), "qty": str(r["qty"]),
               "price": q(r["revenue"] / r["qty"]) if r["qty"] else "0", "cost_unit": q(r["cost"] / r["qty"]) if r["qty"] else "0",
               "revenue": q(r["revenue"]), "cost": q(r["cost"]),
               "ret_docs": len(r["ret_docs"]), "ret_qty": str(r["ret_qty"]), "ret_amount": q(r["ret_amount"]), "ret_cost": q(r["ret_cost"]),
               "profit": q(profit), "margin_pct": str((profit / revenue * 100).quantize(Decimal("0.1"))) if revenue else None}
        out.append(row)
        for f in ("revenue", "cost", "ret_amount", "ret_cost"):
            tot[f] += r[f]
        tot["profit"] += profit
        tot["docs"] += len(r["docs"])
    out.sort(key=lambda x: -Decimal(x["profit"]))
    net_rev = tot["revenue"] - tot["ret_amount"]
    totals = {k: q(v) for k, v in tot.items() if k != "docs"}
    totals["docs"] = int(tot["docs"])
    totals["margin_pct"] = str((tot["profit"] / net_rev * 100).quantize(Decimal("0.1"))) if net_rev else None
    return {"currency": currency, "by": by, "rows": out, "totals": totals, "warnings": sorted(warnings)}

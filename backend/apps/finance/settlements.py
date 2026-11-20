"""O'zaro hisob-kitoblar (MoySklad "Взаиморасчеты"): har bir kontragent bilan valyuta bo'yicha
davr boshidagi qoldiq, kirim, chiqim va davr oxiridagi qoldiq.

Ishora (MoySklad kabi): qoldiq = kirim − chiqim.
  * Kirim  — kontragentdan bizga: uning to'lovlari, u yetkazgan tovar (qabul qilish), mijoz qaytarishi, + korrektirovka.
  * Chiqim — bizdan kontragentga: sotuv / buyurtma (realizatsiya), bizning to'lovlarimiz, yetkazuvchiga qaytarish, − korrektirovka.
  Manfiy qoldiq — kontragent bizga qarzdor; musbat — biz unga qarzdormiz.
"""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Q

from apps.core.money import MoneyBag, q2
from apps.core.tenancy import current_branch_id

ZERO = Decimal("0")


def _entries(counterparty_ids=None, date_to=None):
    """Barcha hisob-kitob yozuvlari: (cp_id, sana, valyuta, kirim, chiqim, hujjat yorlig'i, havola)."""
    from apps.orders.models import Order
    from apps.sales.models import Sale
    from apps.warehouse.models import StockDoc, StockMove

    from .models import Adjustment, Transaction

    bid = current_branch_id()

    def scope(qs, field):
        if counterparty_ids is not None:
            qs = qs.filter(**{f"{field}__in": counterparty_ids})
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    # realizatsiya: yakunlangan sotuvlar va hali sotilmagan (bekor qilinmagan) buyurtmalar
    sales = scope(Sale.objects.filter(status=Sale.Status.COMPLETED), "client_id").prefetch_related("items")
    orders = scope(Order.objects.exclude(status=Order.Status.CANCELLED).exclude(sales__status="completed"), "client_id")
    if bid:
        sales, orders = sales.filter(branch_id=bid), orders.filter(branch_id=bid)
    for s in sales:
        yield s.client_id, s.date, s.currency, ZERO, s.total, f"Sotuv №{s.number}", {"kind": "sale", "id": s.id}
    for o in orders.distinct():
        yield o.client_id, o.date, o.currency, ZERO, o.amount, f"Buyurtma №{o.number}", {"kind": "order", "id": o.id}

    # ombor hujjatlari
    docs = scope(StockDoc.objects.filter(posted=True, counterparty__isnull=False,
                                         type__in=["supply", "purchase_return", "sales_return"]), "counterparty_id")
    for d in docs.prefetch_related("items"):
        inc = d.type in ("supply", "sales_return")
        yield (d.counterparty_id, d.date, d.currency, d.total if inc else ZERO, ZERO if inc else d.total,
               f"{d.get_type_display()} №{d.number}", {"kind": "doc", "id": d.id, "doc_type": d.type})
    legacy = scope(StockMove.objects.filter(type=StockMove.Type.IN, supplier__isnull=False, doc__isnull=True), "supplier_id")
    for m in legacy:
        yield m.supplier_id, m.date, m.currency, m.qty * m.price, ZERO, f"Kirim: {m.material.name}", {"kind": None, "id": None}

    # pul: kontragent ko'rsatilgan barcha to'lovlar
    txs = Transaction.objects.filter(Q(client__isnull=False) | Q(supplier__isnull=False)).select_related("sale", "order")
    if counterparty_ids is not None:
        txs = txs.filter(Q(client_id__in=counterparty_ids) | Q(supplier_id__in=counterparty_ids))
    if date_to:
        txs = txs.filter(date__lte=date_to)
    if bid:
        txs = txs.filter(Q(account__branch_id=bid) | Q(account__branch__isnull=True))
    for t in txs:
        cp = t.client_id or t.supplier_id
        doc = t.sale if t.sale_id else (t.order if t.order_id else None)
        cur, amt = (doc.currency, t.order_amount) if (doc is not None and t.order_amount is not None) else (t.currency, t.amount)
        label = f"{'Kirim' if t.direction == 'in' else 'Chiqim'} №{t.number}"
        link = {"kind": "payment", "id": t.id}
        if t.direction == Transaction.Direction.IN:
            yield cp, t.date, cur, amt, ZERO, label, link
        else:
            yield cp, t.date, cur, ZERO, amt, label, link

    adjs = scope(Adjustment.objects.filter(kind=Adjustment.Kind.COUNTERPARTY), "counterparty_id")
    for a in adjs:
        yield (a.counterparty_id, a.date, a.currency, a.amount if a.amount > 0 else ZERO, -a.amount if a.amount < 0 else ZERO,
               f"Korrektirovka №{a.number}", {"kind": "adjustment", "id": a.id})


def settlements(date_from, date_to, counterparty=None, group=None, currency=None, show_zero=False, search=None):
    """Davr bo'yicha jadval: kontragent × valyuta."""
    from apps.crm.models import Counterparty

    cps = Counterparty.objects.all()
    if counterparty:
        cps = cps.filter(pk=counterparty)
    if group:
        cps = cps.filter(groups__id=group)
    if search:
        cps = cps.filter(Q(name__icontains=search) | Q(phone__icontains=search))
    names = dict(cps.values_list("id", "name"))
    ids = list(names) if (counterparty or group or search) else None

    acc = defaultdict(lambda: [ZERO, ZERO, ZERO])  # (cp, cur) -> [opening, kirim, chiqim]
    for cp, d, cur, inc, out, _l, _k in _entries(ids, date_to):
        if cp not in names or (currency and cur != currency):
            continue
        a = acc[(cp, cur)]
        if d < date_from:
            a[0] += Decimal(inc) - Decimal(out)
        else:
            a[1] += Decimal(inc)
            a[2] += Decimal(out)

    rows, totals = [], {k: MoneyBag() for k in ("opening", "income", "outcome", "closing")}
    for (cp, cur), (op, inc, out) in acc.items():
        closing = op + inc - out
        if not show_zero and not (q2(op) or q2(inc) or q2(out) or q2(closing)):
            continue
        rows.append({"counterparty": cp, "name": names[cp], "currency": cur, "opening": str(q2(op)), "income": str(q2(inc)),
                     "outcome": str(q2(out)), "closing": str(q2(closing))})
        for k, v in (("opening", op), ("income", inc), ("outcome", out), ("closing", closing)):
            totals[k].add(v, cur)
    rows.sort(key=lambda r: (r["name"].lower(), r["currency"]))
    return {"date_from": date_from, "date_to": date_to, "rows": rows, "totals": {k: v.as_dict() for k, v in totals.items()}}


def balance(counterparty, until=None):
    """Kontragent balansi valyuta bo'yicha (to'lov oynasida ko'rsatish uchun)."""
    bag = MoneyBag()
    for _cp, _d, cur, inc, out, _l, _k in _entries([int(counterparty)], until):
        bag.add(Decimal(inc) - Decimal(out), cur)
    return {k: str(q2(v)) for k, v in bag.items() if q2(v)}


def statement(counterparty, date_from, date_to, currency=None):
    """Kontragent bo'yicha hujjatlar ro'yxati (akt-sverka) — davr boshidagi qoldiq va har yozuvdan keyingi qoldiq."""
    entries = sorted(_entries([int(counterparty)], date_to), key=lambda e: (e[1], e[5]))
    opening = defaultdict(lambda: ZERO)
    rows = []
    bal = defaultdict(lambda: ZERO)
    for _cp, d, cur, inc, out, label, link in entries:
        if currency and cur != currency:
            continue
        if d < date_from:
            opening[cur] += Decimal(inc) - Decimal(out)
            bal[cur] = opening[cur]
            continue
        bal[cur] += Decimal(inc) - Decimal(out)
        rows.append({"date": d, "currency": cur, "income": str(q2(inc)), "outcome": str(q2(out)), "label": label,
                     "ref": link, "balance": str(q2(bal[cur]))})
    return {"opening": {k: str(q2(v)) for k, v in opening.items()}, "rows": rows,
            "closing": {k: str(q2(v)) for k, v in bal.items()}}

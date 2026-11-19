"""Aylanma (MoySklad "Обороты"): davr boshi, kirim, chiqim, davr oxiri — soni va tannarx summasi.

Harakatlar post_move bilan bir xil tartibda qayta o'ynatiladi (o'rtacha narx — ombor bo'yicha),
shuning uchun chiqim summasi o'sha paytdagi o'rtacha tannarxda hisoblanadi.
"""
from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from django.db.models import Q

from apps.core.money import MoneyBag, q2
from apps.core.tenancy import current_branch_id

from .models import Material, MaterialGroup, StockMove, Warehouse

ZERO = Decimal("0")


def _n(x):
    """Miqdor matni: eksponentasiz, ortiqcha nollarsiz (30, 2.5)."""
    return format(Decimal(x).normalize(), "f") if x else "0"


def _period(p):
    d1 = date_cls.fromisoformat(p["date_from"]) if p.get("date_from") else date_cls.today().replace(day=1)
    d2 = date_cls.fromisoformat(p["date_to"]) if p.get("date_to") else date_cls.today()
    return d1, d2


def _scope_warehouses(p):
    """Hisobga olinadigan omborlar (filial va filtr bo'yicha). None — cheklovsiz."""
    whs = Warehouse.objects.all()
    bid = current_branch_id()
    if bid:
        whs = whs.filter(branch_id=bid)
    if p.get("warehouse"):
        whs = whs.filter(pk__in=str(p["warehouse"]).split(","))
    elif not bid:
        return None
    return set(whs.values_list("id", flat=True))


def _materials(p):
    mats = Material.objects.exclude(type=Material.Type.SERVICE)
    grp = p.get("group")
    if grp == "none":
        mats = mats.filter(group__isnull=True)
    elif grp:
        g = MaterialGroup.objects.filter(pk=grp).first()
        mats = mats.filter(group_id__in=g.descendant_ids()) if g else mats.none()
    if p.get("type"):
        mats = mats.filter(type__in=p["type"].split(","))
    if p.get("material"):
        mats = mats.filter(pk=p["material"])
    if p.get("search"):
        s = p["search"].strip()
        mats = mats.filter(Q(name__icontains=s) | Q(code__icontains=s) | Q(sku__icontains=s) | Q(barcode__icontains=s))
    return mats


def _flow(typ, wid, to_wid, q, W):
    """Harakat tanlangan omborlar uchun: [(ombor, belgi)] — +1 kirim, −1 chiqim."""
    inside = (lambda w: True) if W is None else (lambda w: w in W)
    if typ == "transfer":
        a, b = inside(wid), inside(to_wid)
        if a and b:
            return []  # ichki ko'chirish — tanlangan omborlar umumiy qoldig'i o'zgarmaydi
        return ([(wid, -1)] if a else []) + ([(to_wid, 1)] if b else [])
    if not inside(wid):
        return []
    if typ == "in":
        return [(wid, 1)]
    if typ == "out":
        return [(wid, -1)]
    return [(wid, 1 if q > 0 else -1)]  # adjust


def turnover_rows(p):
    d1, d2 = _period(p)
    W = _scope_warehouses(p)
    mats = {m.id: m for m in _materials(p).select_related("group")}
    moves = StockMove.objects.filter(date__lte=d2, material_id__in=list(mats)).order_by("date", "id") \
        .values_list("date", "type", "material_id", "warehouse_id", "to_warehouse_id", "qty", "price")

    st = defaultdict(lambda: [ZERO, ZERO])          # (mat, wh) -> [qty, avg] — post_move bilan bir xil
    agg = defaultdict(lambda: [ZERO] * 8)           # mat -> [o_q, o_s, i_q, i_s, x_q, x_s, c_q, c_s]
    opened = False

    def snapshot(idx):
        for (mid, wid), (q, avg) in st.items():
            if W is None or wid in W:
                a = agg[mid]
                a[idx] += q
                a[idx + 1] += q * avg

    for dt, typ, mid, wid, to_wid, q, price in moves.iterator():
        if not opened and dt >= d1:
            snapshot(0)
            opened = True
        q, price = Decimal(q), Decimal(price)
        s = st[(mid, wid)]
        avg_before = s[1]
        # davr ichidagi oqim (kirim/chiqim) — o'rtacha narx o'zgarishidan oldin
        if dt >= d1:
            for _w, sign in _flow(typ, wid, to_wid, q, W):
                unit = price if typ == "in" else avg_before
                amount = abs(q) * unit
                a = agg[mid]
                if sign > 0:
                    a[2] += abs(q)
                    a[3] += amount
                else:
                    a[4] += abs(q)
                    a[5] += amount
        # qoldiqni yangilash (stock_report._historic bilan bir xil)
        if typ == "in":
            total = s[0] * s[1] + q * price
            s[0] += q
            s[1] = total / s[0] if s[0] else ZERO
        elif typ == "out":
            s[0] -= q
        elif typ == "adjust":
            s[0] += q
        elif typ == "transfer" and to_wid:
            s[0] -= q
            d = st[(mid, to_wid)]
            total = d[0] * d[1] + q * avg_before
            d[0] += q
            d[1] = total / d[0] if d[0] else ZERO
    if not opened:
        snapshot(0)
    snapshot(6)

    rows, totals = [], {k: MoneyBag() for k in ("opening", "income", "outcome", "closing")}
    only_moved = p.get("moved") in ("1", "true")
    for mid, a in agg.items():
        m = mats.get(mid)
        if not m or not any(a):
            continue
        if only_moved and not (a[2] or a[4]):
            continue
        row = {"material": mid, "name": m.name, "code": m.code or m.sku, "unit": m.get_unit_display(),
               "group_name": m.group.name if m.group_id else "", "currency": m.currency}
        for i, k in enumerate(("opening", "income", "outcome", "closing")):
            row[k] = _n(a[i * 2])
            row[k + "_sum"] = str(q2(a[i * 2 + 1]))
            totals[k].add(a[i * 2 + 1], m.currency)
        rows.append(row)
    rows.sort(key=lambda r: r["name"].lower())
    return {"date_from": d1, "date_to": d2, "rows": rows, "totals": {k: v.as_dict() for k, v in totals.items()}}


def _doc_ref(mv):
    """Harakat manbai — hujjat nomi va ochish uchun havola."""
    if mv.doc_id:
        d = mv.doc
        return {"kind": "doc", "id": d.id, "doc_type": d.type, "label": f"{d.get_type_display()} №{d.number}"}
    if mv.sale_id:
        return {"kind": "sale", "id": mv.sale_id, "label": f"Sotuv №{mv.sale.number}"}
    if mv.job_id:
        return {"kind": "job", "id": mv.job_id, "label": f"Ishlab chiqarish topshirig'i №{mv.job.number}"}
    if mv.order_id:
        return {"kind": "order", "id": mv.order_id, "label": f"Buyurtma №{mv.order.number}"}
    return {"kind": None, "id": None, "label": mv.get_type_display()}


def material_moves(p):
    """Bitta tovar bo'yicha davrdagi harakatlar (aylanma qatorini bosganda o'ng panel)."""
    d1, d2 = _period(p)
    W = _scope_warehouses(p)
    mid = int(p["material"])
    m = Material.objects.get(pk=mid)
    base = StockMove.objects.filter(material_id=mid)

    opening = ZERO
    for typ, wid, to_wid, q in base.filter(date__lt=d1).values_list("type", "warehouse_id", "to_warehouse_id", "qty"):
        for _w, sign in _flow(typ, wid, to_wid, Decimal(q), W):
            opening += sign * abs(Decimal(q))

    qs = base.filter(date__range=(d1, d2)).select_related("warehouse", "to_warehouse", "supplier", "doc", "sale",
                                                          "sale__client", "job", "order", "doc__counterparty") \
        .order_by("date", "id")
    rows, bal = [], opening
    for mv in qs:
        flow = _flow(mv.type, mv.warehouse_id, mv.to_warehouse_id, Decimal(mv.qty), W)
        if not flow and W is not None:
            continue
        q = abs(Decimal(mv.qty))
        inc = sum(q for _w, s in flow if s > 0)
        out = sum(q for _w, s in flow if s < 0)
        bal += inc - out
        party = (mv.doc.counterparty.name if mv.doc_id and mv.doc.counterparty_id else None) \
            or (mv.sale.client.name if mv.sale_id and mv.sale.client_id else None) \
            or (mv.supplier.name if mv.supplier_id else None)
        wh = mv.warehouse.name + (f" → {mv.to_warehouse.name}" if mv.to_warehouse_id else "")
        rows.append({"id": mv.id, "date": mv.date, "type": mv.type, "type_display": mv.get_type_display(),
                     "ref": _doc_ref(mv), "counterparty": party, "warehouse": wh,
                     "income": _n(inc), "outcome": _n(out), "price": str(q2(mv.price)), "currency": mv.currency,
                     "balance": _n(bal), "note": mv.note})
    return {"material": mid, "name": m.name, "code": m.code or m.sku, "unit": m.get_unit_display(),
            "date_from": d1, "date_to": d2, "opening": _n(opening), "closing": _n(bal), "rows": rows}

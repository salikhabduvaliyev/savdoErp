"""Qoldiqlar hisoboti (MoySklad "Остатки"): joriy yoki istalgan sanaga qoldiq, kengaytirilgan filtrlar."""
from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from django.db.models import Q

from apps.core.models import SystemSettings
from apps.core.tenancy import current_branch_id

from .models import Material, MaterialGroup, Stock, StockMove, Warehouse

ZERO = Decimal("0")
STATE_LABELS = {"ok": "Yetarli", "near_min": "Minimalga yaqin", "low": "Kam"}
STOCK_MODES = {"all", "positive", "negative", "zero", "nonzero"}


def _state(available, minimum, ratio):
    if not minimum:
        return "ok"
    if available <= minimum:
        return "low"
    if available <= minimum * ratio:
        return "near_min"
    return "ok"


def _historic(as_of, wh_ids, mat_ids):
    """Sanaga qoldiq va o'rtacha narx: harakatlar post_move bilan bir xil tartibda qayta o'ynatiladi."""
    moves = StockMove.objects.filter(date__lte=as_of).order_by("date", "id") \
        .values_list("type", "material_id", "warehouse_id", "to_warehouse_id", "qty", "price")
    if mat_ids is not None:
        moves = moves.filter(material_id__in=mat_ids)
    st = defaultdict(lambda: [ZERO, ZERO])  # (mat, wh) -> [qty, avg]
    for typ, mid, wid, to_wid, q, price in moves.iterator():
        q, price = Decimal(q), Decimal(price)
        s = st[(mid, wid)]
        if typ == "in":
            total = s[0] * s[1] + q * price
            s[0] += q
            s[1] = total / s[0] if s[0] else ZERO
        elif typ == "out":
            s[0] -= q
        elif typ == "adjust":
            s[0] += q
        elif typ == "transfer" and to_wid:
            avg = s[1]
            s[0] -= q
            d = st[(mid, to_wid)]
            total = d[0] * d[1] + q * avg
            d[0] += q
            d[1] = total / d[0] if d[0] else ZERO
    return {k: v for k, v in st.items() if wh_ids is None or k[1] in wh_ids}


def stock_rows(params):
    """params: warehouse, group, type, search, stock (all|positive|negative|zero|nonzero), below_min, date (YYYY-MM-DD)."""
    p = params
    ratio = SystemSettings.load().stock_near_min_ratio
    whs = Warehouse.objects.all()
    bid = current_branch_id()
    if bid:
        whs = whs.filter(branch_id=bid)
    if p.get("warehouse"):
        whs = whs.filter(pk__in=str(p["warehouse"]).split(","))
    wh_map = {w.id: w for w in whs}

    mats = Material.objects.select_related("group").exclude(type=Material.Type.SERVICE)
    grp = p.get("group") or p.get("material__group")
    if grp == "none":
        mats = mats.filter(group__isnull=True)
    elif grp:
        g = MaterialGroup.objects.filter(pk=grp).first()
        mats = mats.filter(group_id__in=g.descendant_ids()) if g else mats.none()
    if p.get("type") or p.get("material__type"):
        mats = mats.filter(type__in=(p.get("type") or p.get("material__type")).split(","))
    if p.get("search"):
        s = p["search"].strip()
        mats = mats.filter(Q(name__icontains=s) | Q(code__icontains=s) | Q(sku__icontains=s) | Q(barcode__icontains=s))
    if p.get("material"):
        mats = mats.filter(pk__in=str(p["material"]).split(","))
    if p.get("active") in ("1", "true"):
        mats = mats.filter(is_active=True)
    filtered = bool(grp or p.get("material") or p.get("type") or p.get("material__type") or p.get("search") or p.get("active"))
    mat_map = {m.id: m for m in mats}

    as_of = p.get("date")
    if as_of and (date_cls.fromisoformat(str(as_of)) < date_cls.today()):
        hist = _historic(as_of, set(wh_map), set(mat_map) if filtered else None)
        data = [(mid, wid, q, avg, ZERO) for (mid, wid), (q, avg) in hist.items() if mid in mat_map]
    else:
        stocks = Stock.objects.filter(warehouse_id__in=wh_map, material_id__in=mat_map) if filtered \
            else Stock.objects.filter(warehouse_id__in=wh_map)
        data = [(s.material_id, s.warehouse_id, s.qty, s.avg_cost, s.reserved) for s in stocks]

    mode = p.get("stock") if p.get("stock") in STOCK_MODES else "all"
    rows = []
    for mid, wid, q, avg, reserved in data:
        m = mat_map.get(mid)
        if not m:
            continue
        q = Decimal(q)
        if (mode == "positive" and q <= 0) or (mode == "negative" and q >= 0) or (mode == "zero" and q != 0) \
                or (mode == "nonzero" and q == 0):
            continue
        available = q - Decimal(reserved)
        state = _state(available, m.min_qty, ratio)
        if p.get("below_min") in ("1", "true") and state == "ok":
            continue
        avg = Decimal(avg) or (m.purchase_price if q else ZERO)
        rows.append({
            "id": f"{mid}-{wid}", "material": mid, "material_name": m.name, "code": m.code, "sku": m.sku,
            "material_type": m.type, "unit": m.get_unit_display(), "group": m.group_id,
            "group_name": m.group.name if m.group_id else "", "warehouse": wid, "warehouse_name": wh_map[wid].name,
            "qty": q, "reserved": Decimal(reserved), "available": available, "min_qty": m.min_qty,
            "avg_cost": avg.quantize(Decimal("0.01")), "currency": m.currency, "value": (q * avg).quantize(Decimal("0.01")),
            "state": state, "state_display": STATE_LABELS[state],
        })
    rows.sort(key=lambda r: (r["material_name"].lower(), r["warehouse_name"]))
    return rows

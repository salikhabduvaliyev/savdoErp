"""Buyurtma tannarxi (smeta) va rentabellik.

Maketda smeta jami yo'q edi va USD buyurtmaga so'mdagi xarajatlar qo'shilganda
foydani qanday hisoblash noaniq edi. Qoida:
  * har bir blok valyuta bo'yicha alohida jamlanadi (MoneyBag);
  * buyurtma valyutasiga keltirish:
      A, B — buyurtma sanasidagi kurs (reja tannarx);
      C    — xarajat sanasidagi kurs (Transaction.order_amount);
      D    — ishbay yozuvi sanasidagi kurs;
  * foyda = buyurtma summasi − tannarx (buyurtma valyutasida);
  * rentabellik (marja) = foyda / buyurtma summasi.
"""
from decimal import Decimal

from django.db import transaction

from apps.core.money import MoneyBag, RateNotFound, convert, get_rate, q2

from .models import Estimate, EstimateMaterial, EstimateService, Order

ZERO = Decimal("0")


def order_costing(order: Order) -> dict:
    from apps.finance.models import Transaction
    from apps.hr.models import PieceworkEntry

    cur = order.currency
    estimate = order.active_estimate
    warnings = []

    def conv(amount, from_cur, on_date):
        try:
            return convert(amount, from_cur, cur, on_date)
        except RateNotFound as e:
            warnings.append(str(e))
            return ZERO

    # A — materiallar
    a_rows, a_bag, a_conv = [], MoneyBag(), ZERO
    # B — xizmatlar
    b_rows, b_bag, b_conv = [], MoneyBag(), ZERO
    if estimate:
        for m in estimate.materials.select_related("material"):
            amt = m.amount
            a_bag.add(amt, m.currency)
            a_conv += conv(amt, m.currency, order.date)
            a_rows.append({
                "id": m.id, "material": m.material_id, "material_name": m.material.name,
                "unit": m.material.get_unit_display(), "qty": str(m.qty), "waste_pct": str(m.waste_pct),
                "qty_with_waste": str(q2(m.qty_with_waste)), "price": str(q2(m.price)),
                "currency": m.currency, "amount": str(q2(amt)),
            })
        for s in estimate.services.select_related("operation__department"):
            amt = s.amount
            b_bag.add(amt, s.currency)
            b_conv += conv(amt, s.currency, order.date)
            b_rows.append({
                "id": s.id, "operation": s.operation_id, "operation_name": s.operation.name,
                "department": s.operation.department.name, "unit": s.operation.get_unit_display(),
                "qty": str(s.qty), "rate": str(q2(s.rate)), "currency": s.currency, "amount": str(q2(amt)),
            })

    # C — moliyadan biriktirilgan xarajatlar (yagona manba)
    c_rows, c_bag, c_conv = [], MoneyBag(), ZERO
    for t in order.transactions.filter(direction=Transaction.Direction.OUT).exclude(category__affects_profit=False)             .select_related("category", "supplier"):
        c_bag.add(t.amount, t.currency)
        c_conv += t.order_amount or ZERO
        c_rows.append({
            "id": t.id, "date": t.date.isoformat(),
            "name": t.description or (t.category.name if t.category else t.get_kind_display()),
            "currency": t.currency, "amount": str(q2(t.amount)),
        })

    # D — ish haqi ulushi (ishbay topshiriqlardan, so'mda)
    d_rows, d_bag, d_conv = [], MoneyBag(), ZERO
    for p in PieceworkEntry.objects.filter(task__order=order).select_related("employee", "task__operation"):
        d_bag.add(p.amount, "UZS")
        d_conv += conv(p.amount, "UZS", p.date)
        d_rows.append({
            "id": p.id, "date": p.date.isoformat(), "employee": p.employee.full_name,
            "operation": p.task.operation.name, "qty": str(p.qty), "currency": "UZS", "amount": str(q2(p.amount)),
        })

    # P — pozitsiyalardagi tovar/mahsulot tannarxi: jo'natilgani — sotuvdagi haqiqiy tannarx,
    # qolgani — ombordagi o'rtacha tannarx (bo'lmasa xarid narxi), buyurtma sanasidagi kurs bo'yicha
    p_rows, p_bag, p_conv = [], MoneyBag(), ZERO
    from apps.sales.models import Sale, SaleItem

    for it in order.items.select_related("product"):
        prod = it.product
        if not prod or not prod.is_stocked:
            continue
        shipped = SaleItem.objects.filter(order=order, product=prod, sale__status=Sale.Status.COMPLETED)
        sh_qty = sum((s.qty for s in shipped), ZERO)
        sh_cost = sum((s.cost_amount for s in shipped), ZERO)  # sotuv valyutasi = buyurtma valyutasi
        rest = max(ZERO, Decimal(it.qty) - sh_qty)
        stocks = [s for s in prod.stocks.all() if s.qty > 0]
        sq = sum((s.qty for s in stocks), ZERO)
        unit = (sum((s.qty * s.avg_cost for s in stocks), ZERO) / sq) if sq else Decimal(prod.purchase_price)
        rest_cost = conv(rest * unit, prod.currency, order.date)
        amount = sh_cost + rest_cost
        p_bag.add(amount, cur)
        p_conv += amount
        p_rows.append({"id": it.id, "name": prod.name, "unit": prod.get_unit_display(), "qty": str(it.qty),
                       "shipped": str(sh_qty), "amount": str(q2(amount)), "currency": cur,
                       "basis": "sotuv" if sh_qty >= Decimal(it.qty) else ("aralash" if sh_qty else "o'rtacha tannarx")})

    total_bag = a_bag + b_bag + c_bag + d_bag + p_bag
    cost = a_conv + b_conv + c_conv + d_conv + p_conv
    profit = order.amount - cost
    margin = (profit / order.amount * 100) if order.amount else ZERO
    try:
        rate = str(get_rate(order.date))
    except RateNotFound:
        rate = None

    return {
        "order": order.id,
        "estimate": {"id": estimate.id, "version": estimate.version, "note": estimate.note} if estimate else None,
        "versions": list(order.estimates.values("id", "version", "is_active", "created_at")),
        "currency": cur,
        "rate": rate,
        "blocks": {
            "A": {"rows": a_rows, "total": a_bag.as_dict(), "converted": str(q2(a_conv))},
            "B": {"rows": b_rows, "total": b_bag.as_dict(), "converted": str(q2(b_conv))},
            "C": {"rows": c_rows, "total": c_bag.as_dict(), "converted": str(q2(c_conv))},
            "D": {"rows": d_rows, "total": d_bag.as_dict(), "converted": str(q2(d_conv))},
            "P": {"rows": p_rows, "total": p_bag.as_dict(), "converted": str(q2(p_conv))},
        },
        "total": total_bag.as_dict(),
        "cost": str(q2(cost)),
        "amount": str(q2(order.amount)),
        "profit": str(q2(profit)),
        "margin_pct": str(margin.quantize(Decimal("0.1"))),
        "warnings": sorted(set(warnings)),
    }


def order_cost_value(order: Order) -> Decimal:
    """Faqat tannarx summasi (buyurtma valyutasida) — dashboard uchun."""
    return Decimal(order_costing(order)["cost"])


@transaction.atomic
def new_estimate_version(order: Order, note="") -> Estimate:
    """Joriy faol smetadan nusxa olib yangi versiya yaratadi."""
    current = order.active_estimate
    version = (current.version + 1) if current else 1
    order.estimates.update(is_active=False)
    est = Estimate.objects.create(order=order, version=version, is_active=True, note=note)
    if current:
        for m in current.materials.all():
            EstimateMaterial.objects.create(
                estimate=est, material=m.material, qty=m.qty, waste_pct=m.waste_pct, price=m.price
            )
        for s in current.services.all():
            EstimateService.objects.create(
                estimate=est, operation=s.operation, qty=s.qty, rate=s.rate, currency=s.currency
            )
    return est

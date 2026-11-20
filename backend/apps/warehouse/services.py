"""Ombor biznes-logikasi: harakatlarni o'tkazish, o'rtacha narx, rezerv, yetishmovchilik."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum

from .models import Material, Reservation, Stock, StockMove, Warehouse

ZERO = Decimal("0")


def _stock(material, warehouse) -> Stock:
    stock, _ = Stock.objects.select_for_update().get_or_create(material=material, warehouse=warehouse)
    return stock


@transaction.atomic
def post_move(move: StockMove, allow_negative=False) -> StockMove:
    """Harakatni saqlaydi va qoldiqlarni yangilaydi (atomar)."""
    material = move.material
    move.currency = material.currency
    qty = Decimal(move.qty)
    stock = _stock(material, move.warehouse)

    if move.type == StockMove.Type.IN:
        if qty <= 0:
            raise ValidationError("Kirim miqdori musbat bo'lishi kerak")
        # o'rtacha tortilgan narx
        total_value = stock.qty * stock.avg_cost + qty * Decimal(move.price)
        stock.qty += qty
        stock.avg_cost = (total_value / stock.qty) if stock.qty else ZERO
        stock.save()
        if Decimal(move.price) > 0 and material.purchase_price != Decimal(move.price):
            material.purchase_price = move.price
            material.save(update_fields=["purchase_price"])

    elif move.type == StockMove.Type.OUT:
        if qty <= 0:
            raise ValidationError("Chiqim miqdori musbat bo'lishi kerak")
        own_reserve = ZERO
        if move.order_id:
            res = Reservation.objects.filter(order_id=move.order_id, material=material, warehouse=move.warehouse).first()
            own_reserve = res.qty if res else ZERO
        free = stock.qty - stock.reserved + min(own_reserve, qty)
        if qty > free and not allow_negative:
            raise ValidationError(f"{material}: omborda yetarli emas (mavjud {free.normalize():f})")
        move.price = stock.avg_cost or material.purchase_price
        stock.qty -= qty
        stock.save()
        if move.order_id and own_reserve:
            res.qty = max(ZERO, res.qty - qty)
            res.save()
            _recalc_reserved(material, move.warehouse)

    elif move.type == StockMove.Type.TRANSFER:
        if not move.to_warehouse_id or move.to_warehouse_id == move.warehouse_id:
            raise ValidationError("Qabul qiluvchi omborni tanlang")
        if qty <= 0 or qty > stock.available:
            raise ValidationError(f"{material}: o'tkazish uchun yetarli emas (mavjud {stock.available})")
        move.price = stock.avg_cost
        stock.qty -= qty
        stock.save()
        dst = _stock(material, move.to_warehouse)
        total_value = dst.qty * dst.avg_cost + qty * stock.avg_cost
        dst.qty += qty
        dst.avg_cost = total_value / dst.qty
        dst.save()

    elif move.type == StockMove.Type.ADJUST:
        if stock.qty + qty < 0:
            raise ValidationError("Qoldiq manfiy bo'lib qoladi")
        move.price = stock.avg_cost
        stock.qty += qty
        stock.save()

    move.save()
    return move


def _recalc_reserved(material, warehouse):
    total = Reservation.objects.filter(material=material, warehouse=warehouse).aggregate(s=Sum("qty"))["s"] or ZERO
    Stock.objects.filter(material=material, warehouse=warehouse).update(reserved=total)


def material_need(order):
    """Smetaning faol versiyasi bo'yicha material ehtiyoji (chiqindi bilan) minus berilgani."""
    estimate = order.active_estimate
    if not estimate:
        return {}
    need = {}
    for row in estimate.materials.select_related("material"):
        need[row.material_id] = need.get(row.material_id, ZERO) + row.qty_with_waste
    issued = (
        StockMove.objects.filter(order=order, type=StockMove.Type.OUT)
        .values("material_id")
        .annotate(s=Sum("qty"))
    )
    for r in issued:
        if r["material_id"] in need:
            need[r["material_id"]] = max(ZERO, need[r["material_id"]] - r["s"])
    return need


@transaction.atomic
def reserve_for_order(order):
    """Ehtiyojni bo'sh qoldiqdan rezerv qiladi. Yetishmovchilik ro'yxatini qaytaradi."""
    from apps.production.models import PurchaseRequest

    result = []
    for material_id, need in material_need(order).items():
        material = Material.objects.get(pk=material_id)
        already = Reservation.objects.filter(order=order, material=material).aggregate(s=Sum("qty"))["s"] or ZERO
        to_reserve = need - already
        if to_reserve > 0:
            for stock in Stock.objects.select_for_update().filter(material=material).order_by("-qty"):
                if to_reserve <= 0:
                    break
                take = min(stock.available, to_reserve)
                if take <= 0:
                    continue
                res, _ = Reservation.objects.get_or_create(order=order, material=material, warehouse=stock.warehouse)
                res.qty += take
                res.save()
                _recalc_reserved(material, stock.warehouse)
                to_reserve -= take
        shortage = max(ZERO, to_reserve)
        if shortage > 0:
            PurchaseRequest.objects.update_or_create(
                order=order, material=material, status=PurchaseRequest.Status.OPEN,
                defaults={"qty": shortage, "note": f"Buyurtma {order.number} uchun yetishmaydi"},
            )
        result.append(_shortage_row(material, need, shortage))
    return result


def order_shortages(order):
    """Rezerv + bo'sh qoldiq hisobga olingan holda nima yetishmaydi (aniq miqdor bilan)."""
    rows = []
    for material_id, need in material_need(order).items():
        material = Material.objects.get(pk=material_id)
        reserved = Reservation.objects.filter(order=order, material=material).aggregate(s=Sum("qty"))["s"] or ZERO
        free = sum((s.available for s in Stock.objects.filter(material=material)), ZERO)
        shortage = max(ZERO, need - reserved - free)
        rows.append(_shortage_row(material, need, shortage))
    return rows


def _shortage_row(material, need, shortage):
    return {
        "material_id": material.id,
        "material": material.name,
        "unit": material.get_unit_display(),
        "need": str(need.quantize(Decimal("0.001"))),
        "shortage": shortage.quantize(Decimal("0.001")),
    }


def order_reserve_need(order):
    """Rezerv ehtiyoji: pozitsiyalardagi tovarlar (sotilmagan qismi) + smeta materiallari (berilmagan qismi)."""
    from apps.sales.models import Sale, SaleItem

    need = {}
    for it in order.items.select_related("product"):
        if it.product_id and it.product.is_stocked:
            need[it.product_id] = need.get(it.product_id, ZERO) + Decimal(it.qty)
    sold = (SaleItem.objects.filter(order=order, sale__status=Sale.Status.COMPLETED, product__isnull=False)
            .values("product_id").annotate(s=Sum("qty")))
    for r in sold:
        if r["product_id"] in need:
            need[r["product_id"]] = max(ZERO, need[r["product_id"]] - r["s"])
    for mid, q in material_need(order).items():
        need[mid] = need.get(mid, ZERO) + q
    return {k: v for k, v in need.items() if v > 0}


@transaction.atomic
def sync_order_reservation(order):
    """Buyurtmadagi "Rezerv" belgisiga ko'ra band qilish yoki bo'shatish (zayavka yaratmaydi).
    Belgilanmagan, topshirilgan yoki bekor qilingan buyurtmada rezerv bo'lmaydi."""
    from apps.orders.models import Order

    release_order(order)
    if not order.reserve or order.status in (Order.Status.DELIVERED, Order.Status.CANCELLED):
        return []
    rows = []
    for material_id, need in order_reserve_need(order).items():
        material = Material.objects.get(pk=material_id)
        left = need
        for stock in Stock.objects.select_for_update().filter(material=material, qty__gt=0).order_by("-qty"):
            if left <= 0:
                break
            take = min(stock.available, left)
            if take <= 0:
                continue
            res, _ = Reservation.objects.get_or_create(order=order, material=material, warehouse=stock.warehouse)
            res.qty += take
            res.save()
            _recalc_reserved(material, stock.warehouse)
            left -= take
        rows.append(_shortage_row(material, need, max(ZERO, left)))
    return rows


def release_order(order):
    for res in Reservation.objects.filter(order=order):
        material, wh = res.material, res.warehouse
        res.delete()
        _recalc_reserved(material, wh)


def default_warehouse():
    return Warehouse.objects.order_by("id").first()

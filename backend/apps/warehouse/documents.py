"""Ombor/xarid hujjatlarini o'tkazish (MoySklad: "Провести") va bekor qilish.

O'tkazilganda har bir pozitsiya uchun StockMove yaratiladi (doc=hujjat), qoldiq va o'rtacha narx yangilanadi.
O'tkazish bekor qilinsa — harakatlar teskari qo'llanib o'chiriladi. Hujjat tahrirlansa: bekor → yozish → o'tkazish.
"""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.money import convert

from .models import Stock, StockDoc, StockMove
from .services import _stock, post_move

ZERO = Decimal("0")
T = StockDoc.Type

# qaysi turlar qoldiqqa ta'sir qiladi
STOCK_TYPES = {T.SUPPLY, T.PURCHASE_RETURN, T.ENTER, T.LOSS, T.MOVE, T.INVENTORY, T.SALES_RETURN}


def validate_doc(doc):
    if doc.type in STOCK_TYPES and not doc.warehouse_id:
        raise ValidationError("Omborni tanlang")
    if doc.type == T.MOVE:
        if not doc.to_warehouse_id:
            raise ValidationError("Qaysi omborga ko'chirilishini tanlang")
        if doc.to_warehouse_id == doc.warehouse_id:
            raise ValidationError("Omborlar bir xil bo'lmasligi kerak")
    if doc.type in (T.PURCHASE_ORDER, T.SUPPLY, T.PURCHASE_RETURN) and not doc.counterparty_id:
        raise ValidationError("Yetkazuvchini tanlang")
    if doc.type == T.SALES_RETURN and not doc.counterparty_id:
        raise ValidationError("Mijozni tanlang")


def _unit_price(item, doc):
    """Pozitsiya narxi (chegirma bilan) hujjat valyutasidan material valyutasiga — hujjat sanasidagi kurs bo'yicha."""
    price = Decimal(item.price) * (1 - Decimal(item.discount_pct) / 100)
    return convert(price, doc.currency, item.material.currency, doc.date)


@transaction.atomic
def post_doc(doc: StockDoc):
    """Hujjatni o'tkazish: qoldiqlarga yozish."""
    from apps.core.models import SystemSettings

    doc = StockDoc.objects.select_for_update().get(pk=doc.pk)
    if doc.type not in STOCK_TYPES:
        return doc
    if doc.moves.exists():
        return doc
    validate_doc(doc)
    allow_negative = SystemSettings.load().allow_negative_stock
    items = list(doc.items.select_related("material"))
    if not items:
        raise ValidationError("Hujjatda pozitsiyalar yo'q")
    base = dict(date=doc.date, warehouse=doc.warehouse, doc=doc, created_by=doc.created_by,
                note=f"{doc.get_type_display()} №{doc.number}")
    for it in items:
        m = it.material
        if doc.type in (T.SUPPLY, T.ENTER):
            post_move(StockMove(type=StockMove.Type.IN, material=m, qty=it.qty, price=_unit_price(it, doc),
                                supplier=doc.counterparty if doc.type == T.SUPPLY else None, **base))
        elif doc.type in (T.PURCHASE_RETURN, T.LOSS):
            post_move(StockMove(type=StockMove.Type.OUT, material=m, qty=it.qty,
                                supplier=doc.counterparty if doc.type == T.PURCHASE_RETURN else None, **base),
                      allow_negative=allow_negative)
        elif doc.type == T.MOVE:
            post_move(StockMove(type=StockMove.Type.TRANSFER, material=m, qty=it.qty, to_warehouse=doc.to_warehouse, **base))
        elif doc.type == T.INVENTORY:
            stock = Stock.objects.filter(material=m, warehouse=doc.warehouse).first()
            book = stock.qty if stock else ZERO
            it.book_qty = book
            it.price = stock.avg_cost if stock and stock.avg_cost else m.purchase_price
            it.save()
            diff = Decimal(it.qty) - book
            if diff:
                post_move(StockMove(type=StockMove.Type.ADJUST, material=m, qty=diff, **base))
        elif doc.type == T.SALES_RETURN:
            # tovar omborga tannarx bo'yicha qaytadi
            stock = Stock.objects.filter(material=m, warehouse=doc.warehouse).first()
            cost = stock.avg_cost if stock and stock.avg_cost else m.purchase_price
            post_move(StockMove(type=StockMove.Type.IN, material=m, qty=it.qty, price=cost, **base))
    if not doc.posted:
        doc.posted = True
        doc.save(update_fields=["posted", "updated_at"])
    return doc


def _reverse(move: StockMove, allow_negative=False):
    """Bitta harakatni teskari qo'llash (qoldiq va o'rtacha narx) va o'chirish."""
    qty = Decimal(move.qty)
    stock = _stock(move.material, move.warehouse)
    if move.type == StockMove.Type.IN:
        if stock.qty - qty < 0 and not allow_negative:
            raise ValidationError(f"{move.material}: kirim allaqachon sarflangan — bekor qilsangiz qoldiq manfiy bo'ladi")
        value = stock.qty * stock.avg_cost - qty * Decimal(move.price)
        stock.qty -= qty
        if stock.qty > 0:
            stock.avg_cost = max(ZERO, value / stock.qty)
        stock.save()
    elif move.type == StockMove.Type.OUT:
        value = stock.qty * stock.avg_cost + qty * Decimal(move.price)
        stock.qty += qty
        stock.avg_cost = value / stock.qty if stock.qty > 0 else stock.avg_cost
        stock.save()
    elif move.type == StockMove.Type.TRANSFER:
        dst = _stock(move.material, move.to_warehouse)
        if dst.qty - qty < 0 and not allow_negative:
            raise ValidationError(f"{move.material}: ko'chirilgan tovar allaqachon sarflangan")
        dst.qty -= qty
        dst.save()
        value = stock.qty * stock.avg_cost + qty * Decimal(move.price)
        stock.qty += qty
        stock.avg_cost = value / stock.qty if stock.qty > 0 else stock.avg_cost
        stock.save()
    elif move.type == StockMove.Type.ADJUST:
        if stock.qty - qty < 0 and not allow_negative:
            raise ValidationError(f"{move.material}: qoldiq manfiy bo'lib qoladi")
        stock.qty -= qty
        stock.save()
    move.delete()


@transaction.atomic
def unpost_doc(doc: StockDoc):
    """O'tkazishni bekor qilish (hujjat qoralamaga aylanadi)."""
    from apps.core.models import SystemSettings

    doc = StockDoc.objects.select_for_update().get(pk=doc.pk)
    allow_negative = SystemSettings.load().allow_negative_stock
    for mv in doc.moves.select_related("material", "warehouse", "to_warehouse").order_by("-id"):
        _reverse(mv, allow_negative)
    if doc.posted and doc.type in STOCK_TYPES:
        doc.posted = False
        doc.save(update_fields=["posted", "updated_at"])
    return doc


@transaction.atomic
def write_items(doc: StockDoc, items):
    """Pozitsiyalarni almashtirish. O'tkazilgan hujjat — avval bekor qilinadi, keyin qayta o'tkaziladi."""
    from .models import StockDocItem

    was_posted = doc.posted and doc.moves.exists()
    if was_posted:
        unpost_doc(doc)
        doc.refresh_from_db()
    doc.items.all().delete()
    for pos, it in enumerate(items):
        StockDocItem.objects.create(doc=doc, position=pos, **it)
    return was_posted


def doc_cost(doc: StockDoc) -> Decimal:
    """Hujjat harakatlarining tannarxi (hujjat valyutasida)."""
    total = ZERO
    for mv in doc.moves.all():
        total += convert(Decimal(mv.qty) * Decimal(mv.price), mv.currency, doc.currency, doc.date)
    return total

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


@transaction.atomic
def sale_from_order(order, user):
    """Tayyor buyurtmadan sotuv qoralamasi (yoki mavjud qoralamani qaytaradi)."""
    from apps.orders.models import Order

    existing = order.sales.exclude(status=Sale.Status.CANCELLED).first()
    if existing:
        return existing, False
    if order.status not in (Order.Status.READY, Order.Status.DELIVERED):
        raise ValidationError("Sotuv faqat tayyor buyurtmadan qilinadi")
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

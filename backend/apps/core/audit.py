"""Kompaniya tarixi (audit): muhim hujjatlar va ma'lumotnomalarning yaratilishi, o'zgarishi va o'chirilishi.

API so'rovi ichida (foydalanuvchi aniqlangan) — signal orqali avtomatik yoziladi.
Migratsiya va ichki buyruqlar foydalanuvchisiz bo'lgani uchun yozilmaydi.
"""
from contextvars import ContextVar
from datetime import date, datetime
from decimal import Decimal

from django.db.models.signals import post_delete, post_save, pre_save

_user: ContextVar = ContextVar("erp_audit_user", default=None)
_old = {}  # pre_save → post_save oralig'ida eski qiymatlar (obj id bo'yicha)

SKIP_FIELDS = {"id", "company", "created_at", "updated_at", "number", "amount", "capitalized", "produced_qty",
               "done_qty", "started_at", "finished_at", "password", "last_login"}

# maydon nomlari (verbose_name berilmagan maydonlar uchun)
LABELS = {
    "status": "Holat", "date": "Sana", "plan_date": "Reja sana", "production_date": "Ishlab chiqarish kuni", "note": "Izoh",
    "client": "Mijoz", "counterparty": "Kontragent", "currency": "Valyuta", "warehouse": "Ombor", "to_warehouse": "Qaysi omborga",
    "posted": "O'tkazilgan", "qty": "Miqdor", "name": "Nomi", "price": "Narx", "manager": "Menejer", "operator": "Operator",
    "discount": "Chegirma", "seller": "Sotuvchi", "client_order": "Mijoz buyurtmasi", "techcard": "Texkarta", "product": "Mahsulot",
    "process": "Texjarayon", "output_qty": "Chiqish miqdori", "is_active": "Faol", "type": "Turi", "group": "Guruh",
    "unit": "Birlik", "purchase_price": "Xarid narxi", "supplier": "Yetkazuvchi", "account": "Hisob", "kind": "Turi",
    "category": "Modda", "description": "Izoh", "phone": "Telefon", "price_type": "Narx turi", "volume": "Hajm",
    "materials_warehouse": "Materiallar ombori", "products_warehouse": "Mahsulot ombori", "allow_negative": "Minusga ruxsat",
    "plan_start": "Boshlanish", "plan_end": "Tugash", "extra": "Qo'shimcha maydonlar", "branch": "Filial",
}

# kuzatiladigan modellar: (app_label.Model) → (entity kodi, sarlavha funksiyasi)
TRACKED = {}


def set_user(user):
    _user.set(user if user is not None and getattr(user, "is_authenticated", False) else None)


def current_user():
    return _user.get()


def _title(obj):
    num = getattr(obj, "number", None)
    name = getattr(obj, "name", None) or getattr(obj, "full_name", None)
    label = obj._meta.verbose_name
    if num:
        return f"{label} №{num}"
    return f"{label}: {name}" if name else f"{label} #{obj.pk}"


def _val(v):
    if v is None:
        return None
    if isinstance(v, (Decimal, date, datetime)):
        return str(v)
    if hasattr(v, "pk"):
        return str(v)
    return v if isinstance(v, (int, float, bool, str)) else str(v)


def _snapshot(obj):
    out = {}
    for f in obj._meta.concrete_fields:
        if f.name in SKIP_FIELDS:
            continue
        v = getattr(obj, f.name, None)
        if f.choices and v is not None:
            v = dict(f.flatchoices).get(v, v)  # "new" → "Yangi"
        elif isinstance(v, bool):
            v = "ha" if v else "yo'q"
        label = LABELS.get(f.name) or (str(f.verbose_name) if str(f.verbose_name) != f.name.replace("_", " ") else f.name)
        out[f.name] = (_val(v), str(label))
    return out


def _write(action, obj, changes=None):
    from .models import AuditLog

    user = current_user()
    if user is None or not getattr(obj, "company_id", None):
        return
    entity, title_fn = TRACKED[obj._meta.label]
    AuditLog.objects.create(company_id=obj.company_id, user=user, action=action, entity=entity, entity_id=obj.pk,
                            title=(title_fn or _title)(obj)[:250], changes=changes or {})


def _pre_save(sender, instance, **kw):
    if current_user() is None or not instance.pk:
        return
    old = sender._base_manager.filter(pk=instance.pk).first()
    if old is not None:
        _old[(sender._meta.label, instance.pk)] = _snapshot(old)


def _post_save(sender, instance, created, **kw):
    if current_user() is None:
        return
    if created:
        _write("create", instance)
        return
    before = _old.pop((sender._meta.label, instance.pk), None)
    if before is None:
        return
    after = _snapshot(instance)
    changes = {after[k][1]: [before[k][0], after[k][0]] for k in after if k in before and before[k][0] != after[k][0]}
    if changes:
        _write("update", instance, changes)


def _post_delete(sender, instance, **kw):
    if current_user() is None:
        return
    _write("delete", instance)


def track(model, entity, title=None):
    TRACKED[model._meta.label] = (entity, title)
    pre_save.connect(_pre_save, sender=model, dispatch_uid=f"audit_pre_{entity}")
    post_save.connect(_post_save, sender=model, dispatch_uid=f"audit_post_{entity}")
    post_delete.connect(_post_delete, sender=model, dispatch_uid=f"audit_del_{entity}")


def log(action, obj, changes=None):
    """Qo'lda yozish (masalan: ishni boshlash, status almashtirish)."""
    if obj._meta.label not in TRACKED:
        return
    _write(action, obj, changes)


def register_all():
    from apps.crm.models import Counterparty
    from apps.finance.models import Transaction
    from apps.orders.models import Order
    from apps.production.models import ProductionJob, ProductionOrder, TechCard
    from apps.sales.models import Sale
    from apps.warehouse.models import Material, StockDoc

    track(Order, "order", lambda o: f"Buyurtma №{o.number}")
    track(Sale, "sale", lambda o: f"Sotuv №{o.number}")
    track(ProductionOrder, "production_order", lambda o: f"Ishlab chiqarish buyurtmasi №{o.number}")
    track(ProductionJob, "production_job", lambda o: f"Ishlab chiqarish topshirig'i №{o.number}")
    track(TechCard, "techcard", lambda o: f"Texkarta: {o.name}")
    track(StockDoc, "stock_doc", lambda o: f"{o.get_type_display()} №{o.number}")
    track(Material, "product", lambda o: f"Tovar: {o.name}")
    track(Counterparty, "counterparty", lambda o: f"Kontragent: {o.name}")
    track(Transaction, "transaction", lambda o: f"{o.get_kind_display()}: {o.amount} {o.currency} ({o.date})")

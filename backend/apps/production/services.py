"""Ishlab chiqarish biznes-logikasi (MoySklad modeli)."""
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.money import convert

from apps.orders.models import apply_order_event

from .models import (ProductionJob, ProductionOrder, ProductionOrderItem, ProductionOrderStage, ProductionTask, StageCompletion,
                     TechCard)

ZERO = Decimal("0")
Q3 = Decimal("0.001")


def _q(v):
    return Decimal(v).quantize(Q3, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ yaratish

@transaction.atomic
def create_job_from_techcard(techcard: TechCard, qty, *, materials_warehouse=None, products_warehouse=None,
                             plan_start=None, plan_end=None, production_order=None, branch_id=None, user=None, note="",
                             allow_negative=False):
    qty = Decimal(qty)
    if qty <= 0:
        raise ValidationError("Miqdor musbat bo'lishi kerak")
    if not techcard.process_id or not techcard.process.stages.exists():
        raise ValidationError("Texkartaga bosqichli texjarayon biriktirilmagan")
    job = ProductionJob.objects.create(
        techcard=techcard, qty=qty, materials_warehouse=materials_warehouse, products_warehouse=products_warehouse,
        plan_start=plan_start, plan_end=plan_end, production_order=production_order, branch_id=branch_id,
        order=production_order.client_order if production_order else None, created_by=user, note=note,
        allow_negative=allow_negative,
    )
    for st in techcard.process.stages.select_related("operation"):
        ProductionTask.objects.create(job=job, order=job.order, position=st.position, operation=st.operation,
                                      plan_qty=qty, deadline=plan_end, planned_date=plan_start)
    if job.order_id:
        job.order.on_task_changed()
    return job


def _order_event(order, trigger):
    """Ishlab chiqarishga berildi: bog'langan status bo'lsa — o'shanga, bo'lmasa Yangi → Tasdiqlandi."""
    if apply_order_event(order, trigger):
        return
    if order.status == order.Status.NEW:
        order.status = order.Status.CONFIRMED
        order.save()


@transaction.atomic
def create_job_from_order(order, user=None):
    """Mijoz buyurtmasi (smeta B bloki) asosida topshiriq + materialni rezerv qilish."""
    from apps.warehouse.services import reserve_for_order

    est = order.active_estimate
    if not est or not est.services.exists():
        raise ValidationError("Smetada operatsiyalar (B blok) yo'q")
    job = order.jobs.exclude(status=ProductionJob.Status.CANCELLED).first()
    created = 0
    if job is None:
        job = ProductionJob.objects.create(order=order, qty=order.volume or 1, plan_start=order.production_date,
                                           plan_end=order.plan_date, branch_id=order.branch_id, created_by=user)
    existing = set(ProductionTask.objects.filter(order=order).values_list("operation_id", flat=True))
    services = sorted(est.services.select_related("operation__department"),
                      key=lambda s: (s.operation.department.sequence, s.id))
    for pos, s in enumerate(services):
        if s.operation_id in existing:
            continue
        ProductionTask.objects.create(job=job, order=order, position=pos, operation=s.operation, plan_qty=s.qty,
                                      deadline=order.plan_date, planned_date=order.production_date)
        created += 1
    _order_event(order, "sent_to_production")
    shortages = reserve_for_order(order)
    return job, created, shortages


def order_already_in_production(order):
    """Buyurtma ishlab chiqarishga berilganmi (bekor qilinmagan ishlab chiqarish buyurtmasi yoki topshiriq)."""
    po = order.production_orders.exclude(status=ProductionOrder.Status.CANCELLED).first()
    if po:
        return f"ishlab chiqarish buyurtmasi №{po.number}"
    job = order.jobs.exclude(status=ProductionJob.Status.CANCELLED).first()
    if job:
        return f"topshiriq №{job.number}"
    return None


def _job_from_stages(order, process, stages, *, production_order=None, plan_start=None, plan_end=None, note="", branch_id=None,
                     user=None):
    job = ProductionJob.objects.create(
        order=order, process=process, production_order=production_order,
        qty=(order.volume if order and order.volume else max(q for _, q in stages)),
        plan_start=plan_start or (order.production_date if order else None),
        plan_end=plan_end or (order.plan_date if order else None),
        branch_id=branch_id, note=note or "", created_by=user)
    for pos, (op, q) in enumerate(stages):
        ProductionTask.objects.create(job=job, order=order, position=pos, operation=op, plan_qty=q,
                                      deadline=plan_end or (order.plan_date if order else None),
                                      planned_date=plan_start or (order.production_date if order else None))
    return job


@transaction.atomic
def production_request_from_process(order, process, stages, *, plan_date=None, note="", user=None):
    """Mahsulotsiz (texkartasiz) buyurtma → ishlab chiqarish buyurtmasi (zayavka) texjarayon bosqichlari va kv bilan.
    Ish "Ishlab chiqarish buyurtmalari"da boshlanadi (topshiriq va bosqichlar o'shanda yaratiladi)."""
    if order.status == order.Status.CANCELLED:
        raise ValidationError("Bekor qilingan buyurtma")
    busy = order_already_in_production(order)
    if busy:
        raise ValidationError(f"Buyurtma allaqachon ishlab chiqarishga berilgan ({busy})")
    stages = [(op, _q(q)) for op, q in stages if q and Decimal(q) > 0]
    if not stages:
        raise ValidationError("Kamida bitta bosqichga miqdor kiriting")
    po = ProductionOrder.objects.create(client_order=order, process=process, plan_date=plan_date or order.plan_date,
                                        branch_id=order.branch_id, created_by=user,
                                        note=note or f"Buyurtma №{order.number} asosida")
    for pos, (op, q) in enumerate(stages):
        ProductionOrderStage.objects.create(production_order=po, operation=op, qty=q, position=pos)
    _order_event(order, "sent_to_production")
    return po


@transaction.atomic
def create_jobs_for_production_order(po: ProductionOrder, *, materials_warehouse=None, products_warehouse=None, user=None,
                                     allow_negative=False):
    if po.status == ProductionOrder.Status.CANCELLED:
        raise ValidationError("Bekor qilingan buyurtma")
    jobs = []
    stages = [(st.operation, st.qty) for st in po.stages.select_related("operation")]
    if stages and not po.jobs.exclude(status=ProductionJob.Status.CANCELLED).exists():
        order = po.client_order
        jobs.append(_job_from_stages(order, po.process, stages, production_order=po, plan_end=po.plan_date,
                                     note=po.note, branch_id=po.branch_id, user=user))
        if order is not None and order.status in (order.Status.NEW, order.Status.CONFIRMED):
            if not apply_order_event(order, "production_started"):
                order.status = order.Status.IN_PRODUCTION
                order.save()
    for item in po.items.select_related("techcard__process"):
        if po.jobs.filter(techcard=item.techcard).exclude(status=ProductionJob.Status.CANCELLED).exists():
            continue
        jobs.append(create_job_from_techcard(
            item.techcard, item.qty, materials_warehouse=materials_warehouse, products_warehouse=products_warehouse,
            plan_end=po.plan_date, production_order=po, branch_id=po.branch_id, user=user, allow_negative=allow_negative,
        ))
    if jobs and po.status == ProductionOrder.Status.NEW:
        po.status = ProductionOrder.Status.IN_PROGRESS
        po.save(update_fields=["status", "updated_at"])
    return jobs


# ------------------------------------------------------------------ materiallar

def techcard_requirements(job, task=None, qty=None):
    """Texkarta bo'yicha material ehtiyoji: [(material, miqdor)].
    task berilsa — faqat shu bosqichda sarflanadiganlar (bog'lanmaganlari — birinchi bosqichda)."""
    tc = job.techcard
    out_qty = tc.output_qty or Decimal("1")
    k = Decimal(qty if qty is not None else job.qty) / out_qty
    first_pos = job.tasks.order_by("position", "id").values_list("position", flat=True).first()
    rows = []
    for m in tc.materials.select_related("material"):
        if task is not None:
            bound_here = m.operation_id == task.operation_id
            unbound_first = m.operation_id is None and task.position == first_pos
            if not (bound_here or unbound_first):
                continue
        rows.append((m.material, _q(m.qty * k)))
    return rows


def task_materials_plan(task, qty=None):
    """Shu bosqichning (qolgan) hajmi uchun sarflanadigan materiallar: [(material, miqdor)]."""
    qty = task.remaining if qty is None else Decimal(qty)
    job = task.job
    if job and job.techcard_id:
        return techcard_requirements(job, task=task, qty=qty)
    if task.order_id and task.plan_qty:
        first = ProductionTask.objects.filter(order=task.order).order_by("position", "id").first()
        est = task.order.active_estimate
        if first and first.pk == task.pk and est:
            k = qty / task.plan_qty
            return [(m.material, _q(m.qty_with_waste * k)) for m in est.materials.select_related("material")]
    return []


def task_shortages(task):
    """Bosqichni boshlashdan oldin: faqat shu ish uchun yetishmaydigan materiallar.
    Sozlamada "material yetishmasa ham ishlab chiqarish" yoqilgan bo'lsa — tekshirilmaydi."""
    from apps.core.models import SystemSettings
    from apps.warehouse.models import Stock

    job = task.job
    if (job and job.allow_negative) or SystemSettings.load().production_without_stock:
        return []
    need = {}
    for mat, q in task_materials_plan(task):
        if q > 0 and mat.is_stocked:
            need.setdefault(mat.id, [mat, ZERO])[1] += q
    rows = []
    for mat, q in need.values():
        st = Stock.objects.filter(material=mat)
        if job and job.materials_warehouse_id:
            st = st.filter(warehouse_id=job.materials_warehouse_id)
        avail = sum((s.qty for s in st), ZERO)
        if avail < q:
            rows.append({"material_id": mat.id, "material": mat.name, "unit": mat.get_unit_display(),
                         "need": f"{_q(q).normalize():f}", "available": f"{_q(max(ZERO, avail)).normalize():f}",
                         "shortage": f"{_q(q - max(ZERO, avail)).normalize():f}"})
    return rows


def job_materials(job):
    """Topshiriq materiallari: reja (me'yor), sarflangan, ombordagi mavjud."""
    from apps.warehouse.models import Stock, StockMove

    if job.techcard_id:
        plan = techcard_requirements(job)
    elif job.order_id and job.order.active_estimate:
        k = Decimal("1")
        plan = [(m.material, _q(m.qty_with_waste * k)) for m in job.order.active_estimate.materials.select_related("material")]
    else:
        plan = []
    spent = dict(
        StockMove.objects.filter(job=job, type=StockMove.Type.OUT).values_list("material_id").annotate(s=Sum("qty"))
    )
    if job.order_id:
        for mid, s in StockMove.objects.filter(order=job.order, type=StockMove.Type.OUT, job__isnull=True) \
                .values_list("material_id").annotate(s=Sum("qty")):
            spent[mid] = spent.get(mid, ZERO) + s
    rows = []
    for mat, need in plan:
        stock = Stock.objects.filter(material=mat)
        if job.materials_warehouse_id:
            stock = stock.filter(warehouse_id=job.materials_warehouse_id)
        available = sum((s.available for s in stock), ZERO)
        used = spent.get(mat.id, ZERO)
        rows.append({
            "material_id": mat.id, "material": mat.name, "unit": mat.get_unit_display(),
            "need": str(need), "spent": str(_q(used)), "remaining": str(max(ZERO, _q(need - used))),
            "available": str(_q(available)), "shortage": str(max(ZERO, _q(need - used - available))),
        })
    return rows


def _issue(material, qty, *, job, order=None, warehouse=None, date=None, user=None, note=""):
    from apps.warehouse.models import Reservation, Stock, StockMove
    from apps.warehouse.services import post_move

    if qty <= 0 or not material.is_stocked:
        return None
    wh = warehouse
    if wh is None and order is not None:
        res = Reservation.objects.filter(order=order, material=material, qty__gt=0).select_related("warehouse").first()
        wh = res.warehouse if res else None
    from apps.core.models import SystemSettings

    cfg = SystemSettings.load()
    allow = bool(job and job.allow_negative) or cfg.allow_negative_stock or cfg.production_without_stock
    if wh is None:
        st = Stock.objects.filter(material=material, qty__gt=0).select_related("warehouse").order_by("-qty").first()
        wh = st.warehouse if st else None
    if wh is None and allow:
        from apps.warehouse.services import default_warehouse

        st = Stock.objects.filter(material=material).select_related("warehouse").order_by("-qty").first()
        wh = st.warehouse if st else default_warehouse()
    if wh is None:
        raise ValidationError(f"{material.name}: omborda qoldiq yo'q")
    return post_move(StockMove(date=date or timezone.localdate(), type=StockMove.Type.OUT, material=material,
                               warehouse=wh, qty=qty, order=order, job=job, created_by=user, note=note), allow_negative=allow)


# ------------------------------------------------------------------ bajarish

def _job_cost(job, currency, on_date):
    """Topshiriq bo'yicha haqiqiy xarajat (material chiqimlari + ishbay haq) berilgan valyutada."""
    from apps.hr.models import PieceworkEntry
    from apps.warehouse.models import StockMove

    total = ZERO
    for mv in StockMove.objects.filter(job=job, type=StockMove.Type.OUT):
        total += convert(mv.qty * mv.price, mv.currency, currency, mv.date)
    labor = PieceworkEntry.objects.filter(task__job=job).aggregate(s=Sum("amount"))["s"] or ZERO
    total += convert(labor, "UZS", currency, on_date)
    return total


@transaction.atomic
def complete_stage(task, qty, *, defect_qty=ZERO, employee=None, date=None, user=None, note="", extra_materials=None):
    """extra_materials: [(Material, qty)] — texkartadan tashqari sarflangan qo'shimcha materiallar."""
    from apps.hr.models import PieceworkEntry
    from apps.warehouse.models import StockMove
    from apps.warehouse.services import post_move

    task = ProductionTask.objects.select_for_update().get(pk=task.pk)
    qty = _q(qty)
    date = date or timezone.localdate()
    if qty <= 0:
        raise ValidationError("Miqdor musbat bo'lishi kerak")
    if qty > task.remaining + Q3:
        raise ValidationError(f"Bosqichda qolgan miqdor: {task.remaining.normalize():f}")
    job = task.job
    if job and job.status == ProductionJob.Status.CANCELLED:
        raise ValidationError("Topshiriq bekor qilingan")
    # ketma-ketlik: oldingi bosqich yetarli bajarilgan bo'lishi kerak (texkarta topshiriqlarida)
    if job and job.techcard_id:
        prev = job.tasks.filter(position__lt=task.position).order_by("-position").first()
        if prev and prev.done_qty < task.done_qty + qty:
            raise ValidationError(f"Oldingi bosqich ({prev.operation.name}) faqat {prev.done_qty.normalize():f} bajarilgan")

    tag = f"Topshiriq №{job.number} · {task.operation.name}" if job else task.operation.name
    # 1) materiallar chiqimi
    if job and job.techcard_id:
        for mat, need in techcard_requirements(job, task=task, qty=qty):
            _issue(mat, need, job=job, order=job.order, warehouse=job.materials_warehouse, date=date, user=user, note=tag)
    elif task.order_id:
        first = ProductionTask.objects.filter(order=task.order).order_by("position", "id").first()
        est = task.order.active_estimate
        if first and first.pk == task.pk and est and task.plan_qty:
            k = qty / task.plan_qty
            for m in est.materials.select_related("material"):
                _issue(m.material, _q(m.qty_with_waste * k), job=job, order=task.order,
                       warehouse=job.materials_warehouse if job else None, date=date, user=user, note=tag)

    for mat, q in extra_materials or []:
        q = _q(q)
        if q > 0:
            _issue(mat, q, job=job, order=job.order if job else task.order,
                   warehouse=job.materials_warehouse if job else None, date=date, user=user, note=f"{tag} · qo'shimcha")

    # 2) ishbay haq — bosqichga biriktirilgan xodimga (biriktirilmagan bo'lsa — ko'rsatilgan ijrochiga)
    if task.operation.employee_id:
        employee = task.operation.employee
    rate = task.operation.piece_rate or ZERO
    amount = ZERO
    if employee is not None and rate:
        pw = PieceworkEntry.objects.create(employee=employee, task=task, date=date, qty=qty, rate=rate)
        amount = pw.amount
    StageCompletion.objects.create(task=task, date=date, qty=qty, defect_qty=defect_qty, employee=employee,
                                   piece_rate=rate if employee else ZERO, amount=amount, note=note, created_by=user)

    # 3) bosqich holati
    task.done_qty += qty
    task.defect_qty += Decimal(defect_qty or 0)
    task.started_at = task.started_at or timezone.now()
    if task.remaining <= 0:
        task.status = ProductionTask.Status.DONE
        task.finished_at = timezone.now()
    elif task.status in (ProductionTask.Status.WAITING, ProductionTask.Status.BLOCKED, ProductionTask.Status.PAUSED):
        task.status = ProductionTask.Status.IN_PROGRESS
    task.blocked_reason = ""
    task.save()

    # 4) oxirgi bosqich → mahsulot omborga (texkarta topshiriqlari)
    if job and job.techcard_id:
        last = job.tasks.order_by("-position", "-id").first()
        if last.pk == task.pk:
            product = job.techcard.product
            wh = job.products_warehouse or job.materials_warehouse
            if wh is None:
                raise ValidationError("Mahsulot ombori tanlanmagan")
            value = _job_cost(job, product.currency, date) - job.capitalized
            price = (value / qty) if qty else ZERO
            post_move(StockMove(date=date, type=StockMove.Type.IN, material=product, warehouse=wh, qty=qty,
                                price=max(price, ZERO), job=job, created_by=user, note=f"Topshiriq №{job.number}: tayyor mahsulot"))
            job.produced_qty += qty
            job.capitalized += max(value, ZERO)
            job.save(update_fields=["produced_qty", "capitalized", "updated_at"])

    if task.order_id:
        task.order.on_task_changed()
    if job:
        refresh_job_status(job)
    return task


def refresh_job_status(job):
    tasks = list(job.tasks.all())
    if not tasks or job.status == ProductionJob.Status.CANCELLED:
        return
    new = job.status
    if all(t.status == ProductionTask.Status.DONE for t in tasks):
        new = ProductionJob.Status.DONE
    elif any(t.done_qty > 0 or t.status != ProductionTask.Status.WAITING for t in tasks):
        new = ProductionJob.Status.IN_PROGRESS
    if new != job.status:
        job.status = new
        if new == ProductionJob.Status.IN_PROGRESS and not job.started_at:
            job.started_at = timezone.now()
        if new == ProductionJob.Status.DONE:
            job.finished_at = timezone.now()
        job.save(update_fields=["status", "started_at", "finished_at", "updated_at"])
    po = job.production_order
    if po and po.status != ProductionOrder.Status.CANCELLED:
        statuses = set(po.jobs.exclude(status=ProductionJob.Status.CANCELLED).values_list("status", flat=True))
        target = ProductionOrder.Status.DONE if statuses == {ProductionJob.Status.DONE} else ProductionOrder.Status.IN_PROGRESS
        if po.status != target:
            po.status = target
            po.save(update_fields=["status", "updated_at"])


@transaction.atomic
def cancel_job(job):
    if job.status == ProductionJob.Status.DONE:
        raise ValidationError("Bajarilgan topshiriqni bekor qilib bo'lmaydi")
    if job.tasks.filter(done_qty__gt=0).exists():
        raise ValidationError("Bosqichlar bajarilgan — bekor qilib bo'lmaydi")
    job.status = ProductionJob.Status.CANCELLED
    job.save(update_fields=["status", "updated_at"])
    job.tasks.all().delete()
    return job


def techcard_cost(techcard):
    """Texkarta bo'yicha rejaviy tannarx (1 birlik mahsulot uchun), mahsulot valyutasida."""
    cur = techcard.product.currency
    out = techcard.output_qty or Decimal("1")
    mat = ZERO
    for m in techcard.materials.select_related("material").prefetch_related("material__stocks"):
        stocks = [s for s in m.material.stocks.all() if s.qty > 0]
        q = sum((s.qty for s in stocks), ZERO)
        unit = (sum((s.qty * s.avg_cost for s in stocks), ZERO) / q) if q else m.material.purchase_price
        mat += convert(m.qty * unit, m.material.currency, cur)
    labor = ZERO
    if techcard.process_id:
        for st in techcard.process.stages.select_related("operation"):
            labor += convert(st.operation.piece_rate, "UZS", cur) * out
    extra = Decimal(techcard.extra_cost or 0)
    return {"materials": (mat / out).quantize(Decimal("0.01")), "labor": (labor / out).quantize(Decimal("0.01")),
            "extra": (extra / out).quantize(Decimal("0.01")),
            "total": ((mat + labor + extra) / out).quantize(Decimal("0.01")), "currency": cur}


def production_order_requirements(po: ProductionOrder, warehouse=None):
    """Ishni boshlashdan oldin: texkartalar bo'yicha material ehtiyoji va tanlangan ombordagi mavjud qoldiq."""
    from apps.warehouse.models import Stock

    need = {}
    for item in po.items.select_related("techcard__product"):
        tc = item.techcard
        k = Decimal(item.qty) / (tc.output_qty or Decimal("1"))
        for m in tc.materials.select_related("material"):
            if not m.material.is_stocked:
                continue
            row = need.setdefault(m.material_id, {"material": m.material, "need": ZERO})
            row["need"] += _q(m.qty * k)
    rows = []
    for mid, r in need.items():
        qs = Stock.objects.filter(material_id=mid)
        if warehouse is not None:
            qs = qs.filter(warehouse=warehouse)
        have = sum((s.qty - s.reserved for s in qs), ZERO)
        short = max(ZERO, r["need"] - have)
        rows.append({"material": mid, "name": r["material"].name, "unit": r["material"].get_unit_display(),
                     "need": str(r["need"]), "available": str(have), "shortage": str(short)})
    rows.sort(key=lambda x: (-Decimal(x["shortage"]), x["name"]))
    return rows


@transaction.atomic
def production_order_from_client_order(order, user=None):
    """Mijoz buyurtmasi pozitsiyalaridan (texkartasi bor mahsulotlar) ishlab chiqarish buyurtmasi."""
    existing = order.production_orders.exclude(status=ProductionOrder.Status.CANCELLED).first()
    if existing:
        return existing, False
    if order.jobs.exclude(status=ProductionJob.Status.CANCELLED).exists():
        raise ValidationError(f"Buyurtma allaqachon ishlab chiqarishga berilgan ({order_already_in_production(order)})")
    rows = []
    for it in order.items.select_related("product"):
        if not it.product_id:
            continue
        tc = TechCard.objects.filter(product=it.product, is_active=True).order_by("id").first()
        if tc:
            rows.append((tc, it.qty))
    if not rows:
        raise ValidationError("Buyurtma pozitsiyalarida texkartasi bor mahsulot yo'q")
    po = ProductionOrder.objects.create(client_order=order, plan_date=order.production_date or order.plan_date,
                                        branch_id=order.branch_id, created_by=user, note=f"Buyurtma №{order.number} asosida")
    for tc, q in rows:
        ProductionOrderItem.objects.create(production_order=po, techcard=tc, qty=q)
    _order_event(order, "sent_to_production")
    return po, True


def material_unit_cost(material):
    """Materialning joriy o'rtacha tannarxi (omborlardagi qoldiq bo'yicha, bo'lmasa xarid narxi)."""
    stocks = [st for st in material.stocks.all() if st.qty > 0]
    q = sum((st.qty for st in stocks), ZERO)
    return (sum((st.qty * st.avg_cost for st in stocks), ZERO) / q) if q else material.purchase_price


def order_material_plan(order):
    """Mijoz buyurtmasi uchun material ehtiyoji (MoySklad: Заказ → Материалы).

    Pozitsiyalardagi mahsulotlar texkartasi bo'yicha: me'yor / chiqish miqdori × buyurtma miqdori,
    ustiga faol smetaning A bloki (chiqindi bilan). Berilgani (ombordan chiqim), rezerv va bo'sh qoldiq bilan.
    """
    from django.db.models import Q, Sum

    from apps.warehouse.models import Material, Reservation, Stock, StockMove

    products, need = [], {}

    def add(mat, qty, source):
        r = need.setdefault(mat.id, {"material": mat, "need": ZERO, "sources": []})
        r["need"] += qty
        r["sources"].append(source)

    for it in order.items.select_related("product"):
        if not it.product_id:
            continue
        tc = TechCard.objects.filter(product=it.product, is_active=True).order_by("id").first()
        products.append({"item": it.id, "product": it.product_id, "name": it.product.name, "code": it.product.code,
                         "qty": str(_q(Decimal(it.qty))), "unit": it.product.get_unit_display(),
                         "techcard": tc.id if tc else None, "techcard_name": tc.name if tc else None,
                         "needs_techcard": it.product.type == Material.Type.PRODUCT and not tc})
        if not tc:
            continue
        out = tc.output_qty or Decimal("1")
        for m in tc.materials.select_related("material"):
            if not m.material.is_stocked:
                continue
            norm = Decimal(m.qty) / out
            add(m.material, _q(norm * Decimal(it.qty)),
                {"kind": "techcard", "label": it.product.name, "qty": str(_q(Decimal(it.qty))), "norm": str(_q(norm)),
                 "need": str(_q(norm * Decimal(it.qty))), "techcard": tc.id})

    est = order.active_estimate
    if est:
        for row in est.materials.select_related("material"):
            q = _q(row.qty_with_waste)
            add(row.material, q, {"kind": "estimate", "label": f"Smeta v{est.version}" if hasattr(est, "version") else "Smeta",
                                  "qty": None, "norm": None, "need": str(q)})

    issued_q = StockMove.objects.filter(type=StockMove.Type.OUT, material_id__in=list(need)).filter(
        Q(order=order) | Q(job__order=order) | Q(job__production_order__client_order=order))
    issued = {r["material_id"]: r["s"] for r in issued_q.values("material_id").annotate(s=Sum("qty"))}
    reserved = {r["material_id"]: r["s"] for r in Reservation.objects.filter(order=order, material_id__in=list(need))
                .values("material_id").annotate(s=Sum("qty"))}
    free = {}
    for st in Stock.objects.filter(material_id__in=list(need)):
        free[st.material_id] = free.get(st.material_id, ZERO) + (st.qty - st.reserved)

    rows = []
    for mid, r in need.items():
        mat = r["material"]
        iss = issued.get(mid) or ZERO
        res = reserved.get(mid) or ZERO
        left = max(ZERO, r["need"] - iss)
        avail = free.get(mid, ZERO)
        short = max(ZERO, left - res - max(avail, ZERO))
        rows.append({"material": mid, "name": mat.name, "code": mat.code, "unit": mat.get_unit_display(),
                     "need": str(_q(r["need"])), "issued": str(_q(iss)), "left": str(_q(left)),
                     "reserved": str(_q(res)), "available": str(_q(avail)), "shortage": str(_q(short)),
                     "sources": r["sources"]})
    rows.sort(key=lambda x: (-Decimal(x["shortage"]), x["name"]))
    return {"products": products, "rows": rows}

"""Ishlab chiqarish biznes-logikasi (MoySklad modeli)."""
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.money import convert

from .models import ProductionJob, ProductionOrder, ProductionTask, StageCompletion, TechCard

ZERO = Decimal("0")
Q3 = Decimal("0.001")


def _q(v):
    return Decimal(v).quantize(Q3, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ yaratish

@transaction.atomic
def create_job_from_techcard(techcard: TechCard, qty, *, materials_warehouse=None, products_warehouse=None,
                             plan_start=None, plan_end=None, production_order=None, branch_id=None, user=None, note=""):
    qty = Decimal(qty)
    if qty <= 0:
        raise ValidationError("Miqdor musbat bo'lishi kerak")
    if not techcard.process_id or not techcard.process.stages.exists():
        raise ValidationError("Texkartaga bosqichli texjarayon biriktirilmagan")
    job = ProductionJob.objects.create(
        techcard=techcard, qty=qty, materials_warehouse=materials_warehouse, products_warehouse=products_warehouse,
        plan_start=plan_start, plan_end=plan_end, production_order=production_order, branch_id=branch_id,
        order=production_order.client_order if production_order else None, created_by=user, note=note,
    )
    for st in techcard.process.stages.select_related("operation"):
        ProductionTask.objects.create(job=job, position=st.position, operation=st.operation, plan_qty=qty,
                                      deadline=plan_end, planned_date=plan_start)
    return job


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
    if order.status == order.Status.NEW:
        order.status = order.Status.CONFIRMED
        order.save(update_fields=["status", "updated_at"])
    shortages = reserve_for_order(order)
    return job, created, shortages


@transaction.atomic
def create_jobs_for_production_order(po: ProductionOrder, *, materials_warehouse=None, products_warehouse=None, user=None):
    jobs = []
    for item in po.items.select_related("techcard__process"):
        if po.jobs.filter(techcard=item.techcard).exclude(status=ProductionJob.Status.CANCELLED).exists():
            continue
        jobs.append(create_job_from_techcard(
            item.techcard, item.qty, materials_warehouse=materials_warehouse, products_warehouse=products_warehouse,
            plan_end=po.plan_date, production_order=po, branch_id=po.branch_id, user=user,
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
    if wh is None:
        st = Stock.objects.filter(material=material, qty__gt=0).select_related("warehouse").order_by("-qty").first()
        wh = st.warehouse if st else None
    if wh is None:
        raise ValidationError(f"{material.name}: omborda qoldiq yo'q")
    return post_move(StockMove(date=date or timezone.localdate(), type=StockMove.Type.OUT, material=material,
                               warehouse=wh, qty=qty, order=order, job=job, created_by=user, note=note))


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
def complete_stage(task, qty, *, defect_qty=ZERO, employee=None, date=None, user=None, note=""):
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

    # 2) ishbay haq
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
    return {"materials": (mat / out).quantize(Decimal("0.01")), "labor": (labor / out).quantize(Decimal("0.01")),
            "total": ((mat + labor) / out).quantize(Decimal("0.01")), "currency": cur}

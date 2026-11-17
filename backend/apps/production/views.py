from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from django.db import transaction
from django.db.models import ProtectedError, Q, Sum
from django_filters import rest_framework as filters
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import module_perm
from apps.core.money import q2
from apps.core.tenancy import current_branch_id

from . import services
from .models import (
    Department,
    Operation,
    ProductionJob,
    ProductionOrder,
    ProductionOrderItem,
    ProductionTask,
    PurchaseRequest,
    StageCompletion,
    TechCard,
    TechCardMaterial,
    TechProcess,
    TechProcessStage,
)


def _protected(instance, msg):
    try:
        instance.delete()
    except ProtectedError:
        raise serializers.ValidationError(msg)


def _main_branch_id():
    from apps.core.models import Branch

    return current_branch_id() or Branch.objects.filter(is_main=True).values_list("id", flat=True).first()


# =================================================================== ma'lumotnomalar

class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name", "sequence", "daily_capacity"]


class OperationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    unit_display = serializers.CharField(source="get_unit_display", read_only=True)

    class Meta:
        model = Operation
        fields = ["id", "name", "department", "department_name", "unit", "unit_display",
                  "default_rate", "rate_currency", "piece_rate", "description"]


class DepartmentViewSet(viewsets.ModelViewSet):
    serializer_class = DepartmentSerializer
    module = ("company", "production")
    public_read = True

    def get_queryset(self):
        return Department.objects.all()

    def perform_destroy(self, instance):
        _protected(instance, "Bo'limda bosqich yoki topshiriqlar bor — o'chirib bo'lmaydi")


class OperationViewSet(viewsets.ModelViewSet):
    """Bosqichlar (Этапы)."""

    serializer_class = OperationSerializer
    filterset_fields = ["department"]
    search_fields = ["name"]
    module = ("company", "production")
    public_read = True

    def get_queryset(self):
        return Operation.objects.select_related("department")

    def perform_destroy(self, instance):
        _protected(instance, "Bosqich texjarayon yoki topshiriqlarda ishlatilgan — o'chirib bo'lmaydi")


# =================================================================== texjarayon

class ProcessStageSerializer(serializers.ModelSerializer):
    operation_name = serializers.CharField(source="operation.name", read_only=True)
    department_name = serializers.CharField(source="operation.department.name", read_only=True)

    class Meta:
        model = TechProcessStage
        fields = ["id", "operation", "operation_name", "department_name", "position"]


class TechProcessSerializer(serializers.ModelSerializer):
    stages = ProcessStageSerializer(many=True)

    class Meta:
        model = TechProcess
        fields = ["id", "name", "description", "is_active", "stages"]

    def validate_stages(self, v):
        if not v:
            raise serializers.ValidationError("Kamida bitta bosqich qo'shing")
        return v

    @transaction.atomic
    def _write(self, obj, stages):
        if stages is None:
            return
        obj.stages.all().delete()
        for pos, st in enumerate(stages):
            TechProcessStage.objects.create(process=obj, operation=st["operation"], position=pos)

    def create(self, data):
        stages = data.pop("stages", [])
        obj = TechProcess.objects.create(**data)
        self._write(obj, stages)
        return obj

    def update(self, obj, data):
        stages = data.pop("stages", None)
        obj = super().update(obj, data)
        self._write(obj, stages)
        return obj


class TechProcessViewSet(viewsets.ModelViewSet):
    serializer_class = TechProcessSerializer
    module = "production"
    search_fields = ["name"]

    def get_queryset(self):
        return TechProcess.objects.prefetch_related("stages__operation__department")

    def perform_destroy(self, instance):
        _protected(instance, "Texjarayon texkartalarda ishlatilgan — o'chirib bo'lmaydi")


# =================================================================== texkarta

class TechCardMaterialSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    unit = serializers.CharField(source="material.get_unit_display", read_only=True)
    operation_name = serializers.CharField(source="operation.name", read_only=True, default=None)

    class Meta:
        model = TechCardMaterial
        fields = ["id", "material", "material_name", "unit", "qty", "operation", "operation_name"]


class TechCardSerializer(serializers.ModelSerializer):
    materials = TechCardMaterialSerializer(many=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_unit = serializers.CharField(source="product.get_unit_display", read_only=True)
    process_name = serializers.CharField(source="process.name", read_only=True, default=None)
    cost = serializers.SerializerMethodField()

    class Meta:
        model = TechCard
        fields = ["id", "name", "product", "product_name", "product_unit", "output_qty", "process", "process_name",
                  "note", "is_active", "materials", "cost"]

    def get_cost(self, obj):
        try:
            c = services.techcard_cost(obj)
        except Exception:  # kurs yo'q va h.k.
            return None
        return {k: str(v) for k, v in c.items()}

    def validate(self, attrs):
        if attrs.get("output_qty") is not None and attrs["output_qty"] <= 0:
            raise serializers.ValidationError({"output_qty": "Chiqish miqdori musbat bo'lishi kerak"})
        return attrs

    @transaction.atomic
    def _write(self, obj, mats):
        if mats is None:
            return
        obj.materials.all().delete()
        for m in mats:
            TechCardMaterial.objects.create(techcard=obj, **m)

    def create(self, data):
        mats = data.pop("materials", [])
        obj = TechCard.objects.create(**data)
        self._write(obj, mats)
        return obj

    def update(self, obj, data):
        mats = data.pop("materials", None)
        obj = super().update(obj, data)
        self._write(obj, mats)
        return obj


class TechCardViewSet(viewsets.ModelViewSet):
    serializer_class = TechCardSerializer
    module = "production"
    search_fields = ["name", "product__name"]
    filterset_fields = ["product", "process", "is_active"]

    def get_queryset(self):
        return TechCard.objects.select_related("product", "process").prefetch_related(
            "materials__material__stocks", "materials__operation", "process__stages__operation")

    def perform_destroy(self, instance):
        _protected(instance, "Texkarta topshiriqlarda ishlatilgan — o'chirib bo'lmaydi, nofaol qiling")


# =================================================================== ishlab chiqarish buyurtmasi

class ProductionOrderItemSerializer(serializers.ModelSerializer):
    techcard_name = serializers.CharField(source="techcard.name", read_only=True)
    product_name = serializers.CharField(source="techcard.product.name", read_only=True)
    unit = serializers.CharField(source="techcard.product.get_unit_display", read_only=True)
    produced = serializers.SerializerMethodField()

    class Meta:
        model = ProductionOrderItem
        fields = ["id", "techcard", "techcard_name", "product_name", "unit", "qty", "produced"]

    def get_produced(self, obj):
        s = obj.production_order.jobs.filter(techcard=obj.techcard).aggregate(s=Sum("produced_qty"))["s"]
        return str(s or 0)


class ProductionOrderSerializer(serializers.ModelSerializer):
    items = ProductionOrderItemSerializer(many=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    client_order_number = serializers.IntegerField(source="client_order.number", read_only=True, default=None)
    jobs_count = serializers.SerializerMethodField()

    class Meta:
        model = ProductionOrder
        fields = ["id", "number", "date", "branch", "client_order", "client_order_number", "plan_date", "status",
                  "status_display", "note", "items", "jobs_count"]
        read_only_fields = ["status"]

    def get_jobs_count(self, obj):
        return obj.jobs.exclude(status=ProductionJob.Status.CANCELLED).count()

    def validate_items(self, v):
        if not v:
            raise serializers.ValidationError("Kamida bitta mahsulot qo'shing")
        return v

    @transaction.atomic
    def _write(self, obj, items):
        if items is None:
            return
        obj.items.all().delete()
        for it in items:
            ProductionOrderItem.objects.create(production_order=obj, **it)

    def create(self, data):
        items = data.pop("items", [])
        obj = ProductionOrder.objects.create(**data)
        self._write(obj, items)
        return obj

    def update(self, obj, data):
        items = data.pop("items", None)
        obj = super().update(obj, data)
        self._write(obj, items)
        return obj


class ProductionOrderViewSet(viewsets.ModelViewSet):
    serializer_class = ProductionOrderSerializer
    module = "production"
    filterset_fields = ["status", "client_order"]
    search_fields = ["=number", "note"]
    action_perms = {"create_jobs": "create", "cancel": "edit"}

    def get_queryset(self):
        qs = ProductionOrder.objects.select_related("client_order").prefetch_related("items__techcard__product")
        bid = current_branch_id()
        return qs.filter(branch_id=bid) if bid else qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, branch_id=_main_branch_id())

    @action(detail=True, methods=["post"])
    def create_jobs(self, request, pk=None):
        from apps.warehouse.models import Warehouse

        po = self.get_object()
        mw = Warehouse.objects.filter(pk=request.data.get("materials_warehouse")).first()
        pw = Warehouse.objects.filter(pk=request.data.get("products_warehouse")).first()
        jobs = services.create_jobs_for_production_order(po, materials_warehouse=mw, products_warehouse=pw, user=request.user)
        return Response({"created": len(jobs), "jobs": [j.id for j in jobs]})

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        po = self.get_object()
        for j in po.jobs.exclude(status__in=[ProductionJob.Status.CANCELLED, ProductionJob.Status.DONE]):
            services.cancel_job(j)
        po.status = ProductionOrder.Status.CANCELLED
        po.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(po).data)


# =================================================================== topshiriq va bosqichlar

class TaskSerializer(serializers.ModelSerializer):
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    client_name = serializers.SerializerMethodField()
    job_number = serializers.IntegerField(source="job.number", read_only=True, default=None)
    job_title = serializers.SerializerMethodField()
    operation_name = serializers.CharField(source="operation.name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    unit = serializers.CharField(source="operation.get_unit_display", read_only=True)
    piece_rate = serializers.DecimalField(source="operation.piece_rate", max_digits=18, decimal_places=2, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    progress = serializers.SerializerMethodField()
    remaining = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    overdue_days = serializers.IntegerField(read_only=True)
    materials = serializers.SerializerMethodField()

    class Meta:
        model = ProductionTask
        fields = [
            "id", "job", "job_number", "job_title", "position", "order", "order_number", "client_name", "operation",
            "operation_name", "department", "department_name", "unit", "piece_rate", "plan_qty", "done_qty",
            "remaining", "defect_qty", "status", "status_display", "progress", "deadline", "planned_date",
            "is_overdue", "overdue_days", "started_at", "finished_at", "blocked_reason", "drawing", "note", "materials",
        ]
        read_only_fields = ["department", "status", "started_at", "finished_at", "blocked_reason", "done_qty", "defect_qty"]

    def get_client_name(self, obj):
        return obj.order.client.name if obj.order_id else None

    def get_job_title(self, obj):
        return obj.job.title if obj.job_id else None

    def get_progress(self, obj):
        return float(round(obj.progress, 3))

    def get_materials(self, obj):
        if not self.context.get("with_materials", True):
            return []
        if obj.job_id and obj.job.techcard_id:
            return [{"name": m.name, "qty": str(q), "unit": m.get_unit_display(), "reserved": "0"}
                    for m, q in services.techcard_requirements(obj.job, task=obj, qty=obj.remaining)]
        if not obj.order_id:
            return []
        est = obj.order.active_estimate
        if not est:
            return []
        reserved = {r.material_id: r.qty for r in obj.order.reservations.all()}
        return [{"name": m.material.name, "qty": str(m.qty_with_waste.quantize(m.qty)), "unit": m.material.get_unit_display(),
                 "reserved": str(reserved.get(m.material_id, 0))} for m in est.materials.select_related("material")]


class JobSerializer(serializers.ModelSerializer):
    title = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    product_unit = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    production_order_number = serializers.IntegerField(source="production_order.number", read_only=True, default=None)
    techcard_name = serializers.CharField(source="techcard.name", read_only=True, default=None)
    materials_warehouse_name = serializers.CharField(source="materials_warehouse.name", read_only=True, default=None)
    products_warehouse_name = serializers.CharField(source="products_warehouse.name", read_only=True, default=None)
    stages = serializers.SerializerMethodField()

    class Meta:
        model = ProductionJob
        fields = ["id", "number", "date", "title", "status", "status_display", "techcard", "techcard_name", "order",
                  "order_number", "production_order", "production_order_number", "qty", "produced_qty", "product_unit",
                  "materials_warehouse", "materials_warehouse_name", "products_warehouse", "products_warehouse_name",
                  "plan_start", "plan_end", "started_at", "finished_at", "capitalized", "progress", "note", "stages"]
        read_only_fields = ["status", "produced_qty", "started_at", "finished_at", "capitalized", "order", "production_order"]

    def get_product_unit(self, obj):
        return obj.techcard.product.get_unit_display() if obj.techcard_id else "m²"

    def get_progress(self, obj):
        return float(round(obj.progress, 3))

    def get_stages(self, obj):
        return [{"id": t.id, "operation": t.operation.name, "department": t.department.name, "plan_qty": str(t.plan_qty),
                 "done_qty": str(t.done_qty), "status": t.status, "progress": float(round(t.progress, 3)),
                 "unit": t.operation.get_unit_display()} for t in obj.tasks.all()]


class JobFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    status = filters.BaseInFilter(field_name="status")
    kind = filters.CharFilter(method="filter_kind")

    class Meta:
        model = ProductionJob
        fields = ["techcard", "order", "production_order"]

    def filter_kind(self, qs, name, value):
        if value == "techcard":
            return qs.filter(techcard__isnull=False)
        if value == "order":
            return qs.filter(order__isnull=False, techcard__isnull=True)
        return qs


class JobViewSet(viewsets.ModelViewSet):
    """Ishlab chiqarish topshiriqlari. Yaratish: {techcard, qty, materials_warehouse, products_warehouse, plan_start, plan_end}"""

    serializer_class = JobSerializer
    module = "production"
    filterset_class = JobFilter
    search_fields = ["=number", "techcard__product__name", "order__client__name", "note"]
    http_method_names = ["get", "post", "patch", "head", "options"]
    action_perms = {"cancel": "edit", "materials": "view"}

    def get_queryset(self):
        qs = ProductionJob.objects.select_related(
            "techcard__product", "order__client", "production_order", "materials_warehouse", "products_warehouse"
        ).prefetch_related("tasks__operation", "tasks__department")
        bid = current_branch_id()
        return qs.filter(branch_id=bid) if bid else qs

    def create(self, request, *args, **kwargs):
        from apps.warehouse.models import Warehouse

        d = request.data
        tc = TechCard.objects.filter(pk=d.get("techcard")).first()
        if not tc:
            raise serializers.ValidationError({"techcard": "Texkartani tanlang"})
        mw = Warehouse.objects.filter(pk=d.get("materials_warehouse")).first()
        pw = Warehouse.objects.filter(pk=d.get("products_warehouse")).first()
        if not pw:
            raise serializers.ValidationError({"products_warehouse": "Mahsulot omborini tanlang"})
        parse = lambda v: date_cls.fromisoformat(v) if v else None  # noqa: E731
        job = services.create_job_from_techcard(
            tc, Decimal(str(d.get("qty") or 0)), materials_warehouse=mw, products_warehouse=pw,
            plan_start=parse(d.get("plan_start")), plan_end=parse(d.get("plan_end")),
            branch_id=_main_branch_id(), user=request.user, note=d.get("note", ""),
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=job.pk)).data, status=201)

    @action(detail=True, methods=["get"])
    def materials(self, request, pk=None):
        return Response(services.job_materials(self.get_object()))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return Response(self.get_serializer(services.cancel_job(self.get_object())).data)


class TaskViewSet(viewsets.ModelViewSet):
    """Bosqich topshiriqlari: bo'lim boshlig'i ekrani, bosqichni bajarish."""

    serializer_class = TaskSerializer
    filterset_fields = ["department", "status", "order", "job", "operation"]
    module = "production"
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = ProductionTask.objects.select_related("order__client", "operation", "department", "job__techcard__product",
                                                   "job__order__client")
        user = self.request.user
        if user.own_department_only:
            qs = qs.filter(department_id=user.department_id)
        if self.request.query_params.get("active") in ("1", "true"):
            qs = qs.exclude(status=ProductionTask.Status.DONE).exclude(job__status=ProductionJob.Status.CANCELLED)
        bid = current_branch_id()
        if bid:
            qs = qs.filter(Q(job__branch_id=bid) | Q(job__branch__isnull=True))
        return qs

    def _employee(self):
        from apps.hr.models import Employee

        emp_id = self.request.data.get("employee")
        if emp_id:
            return Employee.objects.filter(pk=emp_id).first()
        return getattr(self.request.user, "employee", None)

    def _done(self, task):
        task.refresh_from_db()
        return Response(self.get_serializer(task).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        task = self.get_object()
        ok = task.start()
        resp = self._done(task)
        if not ok:
            resp.status_code = 409
        return resp

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        task = self.get_object()
        task.pause(request.data.get("reason", ""))
        return self._done(task)

    @action(detail=True, methods=["post"])
    def report(self, request, pk=None):
        task = self.get_object()
        task.report(request.data.get("done_qty"), request.data.get("defect_qty"), employee=self._employee(), user=request.user)
        return self._done(task)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Bosqichni bajarish: {qty, defect_qty?, employee?, date?, note?}"""
        task = self.get_object()
        d = request.data
        services.complete_stage(
            task, Decimal(str(d.get("qty") or 0)), defect_qty=Decimal(str(d.get("defect_qty") or 0)),
            employee=self._employee(), date=date_cls.fromisoformat(d["date"]) if d.get("date") else None,
            user=request.user, note=d.get("note", ""),
        )
        return self._done(task)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        task = self.get_object()
        task.finish(employee=self._employee(), user=request.user)
        return self._done(task)


class CompletionSerializer(serializers.ModelSerializer):
    job_number = serializers.IntegerField(source="task.job.number", read_only=True, default=None)
    job_title = serializers.SerializerMethodField()
    operation_name = serializers.CharField(source="task.operation.name", read_only=True)
    department_name = serializers.CharField(source="task.department.name", read_only=True)
    unit = serializers.CharField(source="task.operation.get_unit_display", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True, default=None)

    class Meta:
        model = StageCompletion
        fields = ["id", "date", "task", "job_number", "job_title", "operation_name", "department_name", "unit", "qty",
                  "defect_qty", "employee", "employee_name", "piece_rate", "amount", "note", "created_at"]

    def get_job_title(self, obj):
        return obj.task.job.title if obj.task.job_id else None


class CompletionFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = StageCompletion
        fields = ["employee", "task__job", "task__department", "task__operation"]


class CompletionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Bosqichlarni bajarish jurnali (Выполнение этапов)."""

    serializer_class = CompletionSerializer
    module = "production"
    filterset_class = CompletionFilter

    def get_queryset(self):
        return StageCompletion.objects.select_related("task__job__techcard__product", "task__job__order__client",
                                                      "task__operation", "task__department", "employee")


@api_view(["GET"])
@permission_classes([module_perm(("production", "hr"))])
def labor(request):
    """Mehnatga haq (Оплата труда): xodim × bosqich bo'yicha davr uchun."""
    qs = StageCompletion.objects.select_related("employee", "task__operation").filter(employee__isnull=False)
    df, dt = request.query_params.get("date_from"), request.query_params.get("date_to")
    if df:
        qs = qs.filter(date__gte=df)
    if dt:
        qs = qs.filter(date__lte=dt)
    rows = defaultdict(lambda: {"qty": Decimal("0"), "amount": Decimal("0"), "ops": defaultdict(lambda: [Decimal("0"), Decimal("0")])})
    names = {}
    for c in qs:
        r = rows[c.employee_id]
        names[c.employee_id] = c.employee.full_name
        r["qty"] += c.qty
        r["amount"] += c.amount
        r["ops"][c.task.operation.name][0] += c.qty
        r["ops"][c.task.operation.name][1] += c.amount
    out = [{"employee": eid, "name": names[eid], "amount": str(q2(r["amount"])),
            "operations": [{"operation": k, "qty": str(v[0]), "amount": str(q2(v[1]))} for k, v in r["ops"].items()]}
           for eid, r in rows.items()]
    out.sort(key=lambda x: -Decimal(x["amount"]))
    return Response({"rows": out, "total": str(q2(sum((Decimal(r["amount"]) for r in out), Decimal("0"))))})


@api_view(["GET"])
@permission_classes([module_perm("production")])
def status_board(request):
    """Ishlab chiqarish holati: faol topshiriqlar × bosqichlar."""
    qs = ProductionJob.objects.exclude(status__in=[ProductionJob.Status.CANCELLED]).select_related(
        "techcard__product", "order__client").prefetch_related("tasks__operation", "tasks__department")
    if request.query_params.get("all") not in ("1", "true"):
        qs = qs.exclude(status=ProductionJob.Status.DONE)
    bid = current_branch_id()
    if bid:
        qs = qs.filter(branch_id=bid)
    jobs = list(qs[:200])
    deps = list(Department.objects.all())
    data = []
    for j in jobs:
        cells = {}
        for t in j.tasks.all():
            c = cells.setdefault(t.department_id, {"plan": Decimal("0"), "done": Decimal("0"), "status": []})
            c["plan"] += t.plan_qty
            c["done"] += t.done_qty
            c["status"].append(t.status)
        data.append({
            "id": j.id, "number": j.number, "title": j.title, "status": j.status, "status_display": j.get_status_display(),
            "plan_end": j.plan_end, "progress": float(round(j.progress, 3)),
            "cells": {str(k): {"progress": float(round(v["done"] / v["plan"], 3)) if v["plan"] else 0,
                               "done": "done" if all(s == "done" for s in v["status"]) else (
                                   "active" if any(s in ("in_progress", "paused") for s in v["status"]) or v["done"] > 0 else (
                                       "blocked" if "blocked" in v["status"] else "waiting"))}
                      for k, v in cells.items()},
        })
    return Response({"departments": [{"id": d.id, "name": d.name} for d in deps], "jobs": data})


# =================================================================== zayavkalar

class PurchaseRequestSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PurchaseRequest
        fields = ["id", "order", "order_number", "material", "material_name", "qty", "status", "status_display", "note", "created_at"]


class PurchaseRequestViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseRequestSerializer
    filterset_fields = ["status", "order"]
    module = ("production", "warehouse")

    def get_queryset(self):
        return PurchaseRequest.objects.select_related("material", "order")

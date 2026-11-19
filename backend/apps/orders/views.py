from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Exists, OuterRef, Q, Sum
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import SystemSettings
from apps.core.tenancy import current_branch_id
from apps.core.money import MoneyBag

from .models import Estimate, EstimateMaterial, EstimateService, Order
from .serializers import (
    EstimateMaterialSerializer,
    EstimateSerializer,
    EstimateServiceSerializer,
    OrderSerializer,
)
from .services import new_estimate_version, order_costing


class OrderFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    plan_from = filters.DateFilter(field_name="plan_date", lookup_expr="gte")
    plan_to = filters.DateFilter(field_name="plan_date", lookup_expr="lte")
    status = filters.BaseInFilter(field_name="status")
    overdue = filters.BooleanFilter(method="filter_overdue")
    has_debt = filters.BooleanFilter(method="filter_debt")
    department = filters.NumberFilter(field_name="tasks__department", distinct=True)

    class Meta:
        model = Order
        fields = ["currency", "client", "manager", "operator"]

    def filter_overdue(self, qs, name, value):
        cond = Q(plan_date__lt=timezone.localdate()) & ~Q(status__in=Order.CLOSED_STATUSES)
        return qs.filter(cond) if value else qs.exclude(cond)

    def filter_debt(self, qs, name, value):
        ids = [o.id for o in qs if (o.debt > 0) == value]
        return qs.filter(id__in=ids)


def with_paid(qs):
    from apps.finance.models import Transaction
    from apps.sales.models import Sale

    return qs.annotate(
        _paid=Sum("transactions__order_amount", filter=Q(transactions__kind=Transaction.Kind.CLIENT_PAYMENT)),
        _sold=Exists(Sale.objects.filter(order=OuterRef("pk"), status="completed")),
    )


def _copy_order(order, user):
    """Buyurtma nusxasi: mijoz, valyuta, pozitsiyalar va qo'shimcha maydonlar; holat — Yangi, sana — bugun."""
    from .models import OrderItem

    new = Order.objects.create(
        client=order.client, currency=order.currency, amount=order.amount, volume=order.volume,
        plan_date=max(order.plan_date, timezone.localdate()), branch=order.branch, manager=order.manager or user,
        operator=order.operator, note=order.note, extra=order.extra, created_by=user,
    )
    for it in order.items.all():
        OrderItem.objects.create(order=new, product=it.product, name=it.name, unit=it.unit, qty=it.qty, price=it.price,
                                 discount_pct=it.discount_pct, position=it.position)
    Estimate.objects.create(order=new, version=1)
    return new


def totals(orders):
    amount, paid, debt = MoneyBag(), MoneyBag(), MoneyBag()
    for o in orders:
        if o.status == Order.Status.CANCELLED:
            continue
        amount.add(o.amount, o.currency)
        paid.add(o.paid, o.currency)
        debt.add(o.debt, o.currency)
    return {"amount": amount.as_dict(), "paid": paid.as_dict(), "debt": debt.as_dict()}


class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    filterset_class = OrderFilter
    search_fields = ["=number", "client__name", "note"]
    ordering_fields = ["number", "date", "plan_date", "amount"]
    module = "orders"
    action_perms = {"bulk": "view"}

    def get_queryset(self):
        qs = Order.objects.select_related("client", "manager__employee", "operator__employee", "branch").prefetch_related("tasks__department", "items__product", "production_orders")
        bid = current_branch_id()
        if bid:
            qs = qs.filter(branch_id=bid)
        user = self.request.user
        if user.scope("orders") == "own":
            qs = qs.filter(Q(manager=user) | Q(operator=user) | Q(created_by=user))
        from apps.core.custom_fields import filter_by_extra

        # GROUP BY so'rovlarida Meta.ordering qo'llanmaydi — tartib aniq beriladi (eng yangisi tepada)
        return with_paid(filter_by_extra(qs, self.request.query_params)).order_by("-date", "-number")

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        if request.query_params.get("negative_profit") in ("1", "true"):
            from .services import with_costing

            qs = with_costing(qs)
        orders = list(qs)
        if request.query_params.get("negative_profit") in ("1", "true"):
            orders = [o for o in orders if Decimal(order_costing(o)["profit"]) < 0]
        data = self.get_serializer(orders, many=True).data
        return Response({"count": len(orders), "results": data, "totals": totals(orders)})

    def perform_create(self, serializer):
        from apps.core.models import Branch

        branch = serializer.validated_data.get("branch")
        branch_id = branch.id if branch else (
            current_branch_id() or Branch.objects.filter(is_main=True).values_list("id", flat=True).first())
        order = serializer.save(manager=serializer.validated_data.get("manager") or self.request.user,
                                created_by=self.request.user, branch_id=branch_id)
        Estimate.objects.create(order=order, version=1)

    # --- holat ---
    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        order = self.get_object()
        new = request.data.get("status")
        if new not in Order.Status.values:
            return Response({"detail": "Noto'g'ri status"}, status=400)
        _apply_status(order, new)
        return Response(self.get_serializer(with_paid(Order.objects.filter(pk=order.pk)).first()).data)

    @action(detail=False, methods=["post"])
    def bulk_status(self, request):
        ids, new = request.data.get("ids", []), request.data.get("status")
        if new not in Order.Status.values:
            return Response({"detail": "Noto'g'ri status"}, status=400)
        with transaction.atomic():
            for order in Order.objects.filter(id__in=ids):
                _apply_status(order, new)
        return Response({"updated": len(ids)})

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Ommaviy amal (MoySklad "Изменить"): {ids, action: delete|copy|status, status?}. Har biri alohida — xatolar ro'yxatda."""
        from django.core.exceptions import ValidationError as DjValidationError
        from django.db.models import ProtectedError

        ids, act = request.data.get("ids", []), request.data.get("action")
        user = request.user
        need = {"delete": "delete", "copy": "create", "status": "edit"}.get(act)
        if not need:
            return Response({"detail": "Noma'lum amal"}, status=400)
        if not user.can("orders", need):
            return Response({"detail": "Bu amal uchun huquqingiz yo'q"}, status=403)
        done, errors, created = 0, [], []
        for order in self.get_queryset().filter(id__in=ids):
            try:
                with transaction.atomic():
                    if act == "delete":
                        if order.transactions.exists() or order.sales.exists():
                            raise DjValidationError("to'lov yoki sotuv bor — o'chirib bo'lmaydi, bekor qiling")
                        order.delete()
                    elif act == "status":
                        new = request.data.get("status")
                        if new not in Order.Status.values:
                            raise DjValidationError("noto'g'ri status")
                        _apply_status(order, new)
                    elif act == "copy":
                        created.append(_copy_order(order, user).id)
                done += 1
            except (DjValidationError, ProtectedError) as e:
                msg = "; ".join(e.messages) if hasattr(e, "messages") else "bog'langan hujjatlar bor"
                errors.append(f"№{order.number}: {msg}")
        return Response({"done": done, "errors": errors, "created": created})

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """Kalendarda kartochkani sudrash: production_date o'zgaradi (reja sana emas)."""
        order = self.get_object()
        value = request.data.get("production_date")
        order.production_date = date.fromisoformat(value) if value else None
        order.save(update_fields=["production_date", "updated_at"])
        return Response({"id": order.id, "production_date": order.production_date})

    # --- smeta ---
    @action(detail=True, methods=["get"])
    def costing(self, request, pk=None):
        return Response(order_costing(self.get_object()))

    @action(detail=True, methods=["post"])
    def new_estimate(self, request, pk=None):
        est = new_estimate_version(self.get_object(), note=request.data.get("note", ""))
        return Response(EstimateSerializer(est).data, status=201)

    # --- ishlab chiqarish va ombor ---
    @action(detail=True, methods=["post"])
    def send_to_production(self, request, pk=None):
        """Ishlab chiqarishga yuborish.
        Pozitsiyalarda texkartali mahsulot bo'lsa — ishlab chiqarish buyurtmasi yaratiladi (MoySklad uslubi);
        aks holda smeta (B blok) asosida bosqichli topshiriq."""
        from apps.production.services import create_job_from_order, production_order_from_client_order

        order = self.get_object()
        if order.items.filter(product__isnull=False).exists():
            po, created = production_order_from_client_order(order, user=request.user)
            return Response({"production_order": po.id, "production_order_number": po.number, "created": created})
        job, created, shortages = create_job_from_order(order, user=request.user)
        for s in shortages:
            s["shortage"] = str(s["shortage"])
        return Response({"job": job.id, "job_number": job.number, "created_tasks": created, "materials": shortages})

    @action(detail=True, methods=["get"])
    def material_plan(self, request, pk=None):
        """Material ehtiyoji: pozitsiyalar texkartasi (me'yor × miqdor) + smeta, berilgani va qoldiq bilan."""
        from apps.production.services import order_material_plan

        return Response(order_material_plan(self.get_object()))

    @action(detail=True, methods=["get"])
    def shortages(self, request, pk=None):
        from apps.warehouse.services import order_shortages

        rows = order_shortages(self.get_object())
        for r in rows:
            r["shortage"] = str(r["shortage"])
        return Response(rows)

    # --- ko'rinishlar ---
    @action(detail=False, methods=["get"])
    def kanban(self, request):
        # Topshirilganlar faqat oxirgi 14 kun — aks holda ustun cheksiz o'sadi
        recent = timezone.localdate() - timedelta(days=SystemSettings.load().kanban_delivered_days)
        orders = list(
            self.filter_queryset(self.get_queryset())
            .exclude(status=Order.Status.CANCELLED)
            .exclude(status=Order.Status.DELIVERED, delivered_at__lt=recent)
        )
        data = self.get_serializer(orders, many=True).data
        columns = []
        for value, label in Order.Status.choices:
            if value == Order.Status.CANCELLED:
                continue
            cards = [d for d in data if d["status"] == value]
            bag = MoneyBag()
            for c in cards:
                bag.add(c["amount"], c["currency"])
            # Ustun jami valyuta bo'yicha alohida (maketda "22 000 000 so'm" deb aralash edi)
            columns.append({"status": value, "label": label, "count": len(cards), "total": bag.as_dict(), "cards": cards})
        return Response(columns)

    @action(detail=False, methods=["get"])
    def calendar(self, request):
        start = request.query_params.get("start")
        days = int(request.query_params.get("days", 7))
        start = date.fromisoformat(start) if start else timezone.localdate() - timedelta(days=timezone.localdate().weekday())
        end = start + timedelta(days=days - 1)
        qs = self.filter_queryset(self.get_queryset()).filter(production_date__range=(start, end)).exclude(
            status=Order.Status.CANCELLED
        )
        orders = list(qs)
        data = self.get_serializer(orders, many=True).data
        capacity = SystemSettings.load().daily_capacity
        result = []
        for i in range(days):
            d = start + timedelta(days=i)
            cards = [c for c, o in zip(data, orders) if o.production_date == d]
            volume = sum((o.volume for o in orders if o.production_date == d), Decimal("0"))
            load = float(round(volume / capacity * 100)) if capacity else 0
            result.append({"date": d.isoformat(), "load_pct": load, "volume": str(volume), "overload": load > 100, "cards": cards})
        unscheduled = self.get_serializer(
            self.get_queryset().filter(production_date__isnull=True).exclude(status__in=Order.CLOSED_STATUSES), many=True
        ).data
        return Response({"start": start, "capacity": str(capacity), "days": result, "unscheduled": unscheduled})


def _apply_status(order, new):
    from apps.warehouse.services import release_order

    order.status = new
    order.save()
    if new == Order.Status.CANCELLED:
        release_order(order)


class EstimateRowMixin:
    module = "orders"
    filterset_fields = ["estimate"]

    def perform_create(self, serializer):
        est = serializer.validated_data["estimate"]
        if not est.is_active:
            raise serializers.ValidationError("Faqat faol smeta versiyasini o'zgartirish mumkin")
        serializer.save()


class EstimateMaterialViewSet(EstimateRowMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        return EstimateMaterial.objects.select_related("material")

    serializer_class = EstimateMaterialSerializer


class EstimateServiceViewSet(EstimateRowMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        return EstimateService.objects.select_related("operation")

    serializer_class = EstimateServiceSerializer


class EstimateViewSet(viewsets.ReadOnlyModelViewSet):
    def get_queryset(self):
        return Estimate.objects.all()

    serializer_class = EstimateSerializer
    filterset_fields = ["order", "is_active"]
    module = "orders"

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        est = self.get_object()
        est.order.estimates.update(is_active=False)
        est.is_active = True
        est.save(update_fields=["is_active"])
        return Response(self.get_serializer(est).data)


from decimal import Decimal

from django.db import transaction

from django.db.models import DecimalField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django_filters import rest_framework as filters
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import Branch
from apps.core.money import MoneyBag
from apps.core.tenancy import current_branch_id

from . import services
from .models import Sale, SaleItem
from .serializers import SaleListSerializer, SaleSerializer


class SaleFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    status = filters.BaseInFilter(field_name="status")

    class Meta:
        model = Sale
        fields = ["client", "currency", "seller", "warehouse", "order"]


def with_totals(qs):
    from apps.finance.models import Transaction

    sub = (SaleItem.objects.filter(sale=OuterRef("pk")).values("sale")
           .annotate(s=Sum("amount")).values("s"))
    # Sale.payments_qs bilan bir xil qoida: sotuvga to'lov + buyurtmaga oldin to'langan avans
    paid = (Transaction.objects.filter(Q(sale=OuterRef("pk")) | Q(order=OuterRef("order_id"), sale__isnull=True, order__isnull=False),
                                       kind=Transaction.Kind.CLIENT_PAYMENT)
            .order_by().values("kind").annotate(s=Sum("order_amount")).values("s"))
    return qs.annotate(_subtotal=Coalesce(Subquery(sub, output_field=DecimalField()), Value(Decimal("0"))),
                       _paid=Coalesce(Subquery(paid, output_field=DecimalField()), Value(Decimal("0"))))


class SaleViewSet(viewsets.ModelViewSet):
    module = "sales"
    filterset_class = SaleFilter
    search_fields = ["=number", "client__name", "note"]
    ordering_fields = ["number", "date"]
    action_perms = {"from_order": "create", "complete": "post", "cancel": "post", "unpost": "post", "pay": "edit", "bulk": "view",
                    "profitability": "view"}

    def get_serializer_class(self):
        return SaleListSerializer if self.action == "list" else SaleSerializer

    def get_queryset(self):
        qs = with_totals(Sale.objects.select_related("client", "branch", "warehouse", "seller__employee", "order", "price_type")
                         .prefetch_related("items__product", "items__order"))
        bid = current_branch_id()
        if bid:
            qs = qs.filter(branch_id=bid)
        user = self.request.user
        if user.scope("sales") == "own":
            qs = qs.filter(Q(seller=user) | Q(created_by=user))
        return qs

    def list(self, request, *args, **kwargs):
        rows = list(self.filter_queryset(self.get_queryset()))
        total, paid, debt = MoneyBag(), MoneyBag(), MoneyBag()
        for s in rows:
            if s.status == Sale.Status.COMPLETED:
                total.add(s.total, s.currency)
                paid.add(s.paid, s.currency)
                debt.add(s.debt, s.currency)
        return Response({"count": len(rows), "results": self.get_serializer(rows, many=True).data,
                         "totals": {"total": total.as_dict(), "paid": paid.as_dict(), "debt": debt.as_dict()}})

    def perform_create(self, serializer):
        user = self.request.user
        branch_id = current_branch_id() or Branch.objects.filter(is_main=True).values_list("id", flat=True).first()
        if serializer.validated_data.get("branch"):
            branch_id = serializer.validated_data["branch"].id
        serializer.save(created_by=user, seller=serializer.validated_data.get("seller") or user, branch_id=branch_id)

    def perform_destroy(self, instance):
        from django.core.exceptions import ValidationError as DjValidationError

        try:
            services.delete_sale(instance)
        except DjValidationError as e:
            raise serializers.ValidationError({"detail": "; ".join(e.messages)})

    def _detail(self, sale):
        return Response(SaleSerializer(self.get_queryset().get(pk=sale.pk), context={"request": self.request}).data)

    @action(detail=False, methods=["post"])
    def from_order(self, request):
        """Tayyor buyurtmadan sotuv: {order: id}"""
        from apps.orders.models import Order

        order = Order.objects.filter(pk=request.data.get("order")).first()
        if not order:
            raise serializers.ValidationError({"order": "Buyurtma topilmadi"})
        sale, created = services.sale_from_order(order, request.user)
        resp = self._detail(sale)
        resp.status_code = 201 if created else 200
        return resp

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Ommaviy amal: {ids, action: complete|unpost|delete}"""
        from django.core.exceptions import ValidationError as DjValidationError

        ids, act = request.data.get("ids", []), request.data.get("action")
        need = {"complete": "post", "unpost": "post", "cancel": "post", "delete": "delete"}.get(act)
        if not need:
            return Response({"detail": "Noma'lum amal"}, status=400)
        if not request.user.can("sales", need):
            return Response({"detail": "Bu amal uchun huquqingiz yo'q"}, status=403)
        done, errors = 0, []
        for sale in self.get_queryset().filter(id__in=ids):
            try:
                with transaction.atomic():
                    if act == "complete":
                        services.complete_sale(sale)
                    elif act == "unpost":
                        services.unpost_sale(sale)
                    elif act == "cancel":
                        services.cancel_sale(sale)
                    else:
                        self.perform_destroy(sale)
                done += 1
            except (DjValidationError, serializers.ValidationError) as e:
                msg = "; ".join(e.messages) if hasattr(e, "messages") else "; ".join(str(x) for x in (e.detail if isinstance(e.detail, list) else [e.detail]))
                errors.append(f"№{sale.number}: {msg}")
        return Response({"done": done, "errors": errors})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._detail(services.complete_sale(self.get_object()))

    @action(detail=True, methods=["post"])
    def unpost(self, request, pk=None):
        """O'tkazishni bekor qilish — qoralamaga qaytaradi."""
        from django.core.exceptions import ValidationError as DjValidationError

        try:
            return self._detail(services.unpost_sale(self.get_object()))
        except DjValidationError as e:
            raise serializers.ValidationError({"detail": "; ".join(e.messages)})

    @action(detail=False, methods=["get"])
    def profitability(self, request):
        """Foydalilik: ?date_from&date_to&by=product|client|seller&currency=UZS&warehouse="""
        from datetime import date as date_cls

        from django.utils import timezone

        from apps.core.currency import company_base_currency

        p = request.query_params
        today = timezone.localdate()
        d1 = date_cls.fromisoformat(p["date_from"]) if p.get("date_from") else today.replace(day=1)
        d2 = date_cls.fromisoformat(p["date_to"]) if p.get("date_to") else today
        data = services.profitability(d1, d2, by=p.get("by", "product"), currency=(p.get("currency") or company_base_currency()).upper(),
                                      warehouse=p.get("warehouse") or None)
        return Response({"date_from": d1, "date_to": d2, **data})

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._detail(services.cancel_sale(self.get_object()))

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Sotuv oynasidan to'lov qabul qilish: {account, amount, date?, description?}"""
        from apps.finance.models import Account

        sale = self.get_object()
        account = Account.objects.filter(pk=request.data.get("account"), is_active=True).first()
        if not account:
            raise serializers.ValidationError({"account": "Kassa/hisobni tanlang"})
        try:
            amount = Decimal(str(request.data.get("amount")))
        except Exception:
            raise serializers.ValidationError({"amount": "Summani kiriting"})
        services.register_payment(sale, account=account, amount=amount, date=request.data.get("date") or None,
                                  description=request.data.get("description", ""), user=request.user)
        return self._detail(sale)

    @action(detail=True, methods=["get"])
    def payments(self, request, pk=None):
        from apps.finance.views import TransactionSerializer

        sale = self.get_object()
        return Response(TransactionSerializer(sale.payments_qs().select_related("account", "order", "sale", "client"),
                                              many=True).data)

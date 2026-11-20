from django.db.models import Count, ProtectedError, Q
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Counterparty, CounterpartyGroup, CounterpartyNote, CounterpartyStatus


class GroupSerializer(serializers.ModelSerializer):
    count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = CounterpartyGroup
        fields = ["id", "name", "color", "count"]


class StatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = CounterpartyStatus
        fields = ["id", "name", "color", "position"]


class NoteSerializer(serializers.ModelSerializer):
    author = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = CounterpartyNote
        fields = ["id", "counterparty", "text", "author", "created_at"]


class CounterpartySerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    orders_count = serializers.IntegerField(read_only=True, default=0)
    price_type_name = serializers.CharField(source="price_type.name", read_only=True, default=None)
    groups = serializers.PrimaryKeyRelatedField(many=True, queryset=CounterpartyGroup.objects, required=False)
    group_list = serializers.SerializerMethodField()
    status_name = serializers.CharField(source="status.name", read_only=True, default=None)
    status_color = serializers.CharField(source="status.color", read_only=True, default=None)
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)

    class Meta:
        model = Counterparty
        fields = ["id", "name", "code", "kind", "kind_display", "groups", "group_list", "status", "status_name",
                  "status_color", "owner", "owner_name", "is_client", "is_supplier", "phone", "phone2",
                  "email", "address", "contact_person", "inn", "bank_name", "bank_mfo", "bank_account", "source",
                  "supplies", "price_type", "price_type_name", "note", "is_active", "extra", "created_at", "orders_count"]

    def get_group_list(self, obj):
        return [{"id": g.id, "name": g.name, "color": g.color} for g in obj.groups.all()]

    def validate_extra(self, v):
        from apps.core.custom_fields import clean_extra

        return clean_extra("counterparty", v, partial=self.partial, existing=getattr(self.instance, "extra", None))

    def create(self, data):
        if data.get("status") is None:
            data["status"] = CounterpartyStatus.objects.order_by("position", "id").first()
        return super().create(data)


class CounterpartyViewSet(viewsets.ModelViewSet):
    """?role=client|supplier  ?with_debt=1"""

    serializer_class = CounterpartySerializer
    module = "counterparties"
    public_read = True  # tanlash ro'yxatlari (buyurtma, sotuv, ombor, moliya) uchun
    search_fields = ["name", "phone", "inn", "contact_person"]
    filterset_fields = ["kind", "is_active", "is_client", "is_supplier"]

    def get_queryset(self):
        from apps.core.custom_fields import filter_by_extra

        qs = (Counterparty.objects.annotate(orders_count=Count("orders", filter=~Q(orders__status="cancelled"), distinct=True))
              .select_related("status", "owner", "price_type").prefetch_related("groups"))
        p = self.request.query_params
        if p.get("group"):
            qs = qs.filter(groups__id__in=p["group"].split(",")).distinct()
        if p.get("status"):
            qs = qs.filter(status_id=p["status"])
        if p.get("owner"):
            qs = qs.filter(owner_id=p["owner"])
        return filter_by_extra(qs, p)

    def perform_create(self, serializer):
        serializer.save(owner=serializer.validated_data.get("owner") or self.request.user)

    def list(self, request, *args, **kwargs):
        rows = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data
        if request.query_params.get("with_debt") in ("1", "true") and request.user.can_view("counterparties"):
            # Sof balans (o'zaro hisob-kitob): kontragent ham mijoz, ham yetkazuvchi bo'lsa — qarzlar bir-biridan ayriladi.
            # Manfiy — u bizga qarzdor (receivable), musbat — biz unga qarzdormiz (payable).
            from collections import defaultdict
            from decimal import Decimal

            from apps.finance.settlements import _entries

            net = defaultdict(lambda: defaultdict(Decimal))
            for cp, _d, cur, inc, out, _l, _k in _entries():
                net[cp][cur] += Decimal(inc) - Decimal(out)
            for r in rows:
                bal = net.get(r["id"], {})
                curs = {"UZS", "USD", *bal.keys()}
                r["balance"] = {c: f"{bal.get(c, Decimal(0)):.2f}" for c in curs}
                r["receivable"] = {c: f"{max(-bal.get(c, Decimal(0)), Decimal(0)):.2f}" for c in curs}
                r["payable"] = {c: f"{max(bal.get(c, Decimal(0)), Decimal(0)):.2f}" for c in curs}
        return Response(rows)

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError:
            raise serializers.ValidationError("Bu kontragent hujjatlarda ishlatilgan — o'chirib bo'lmaydi. Uni nofaol qiling.")

    @action(detail=True, methods=["get"])
    def card(self, request, pk=None):
        """Kontragent kartasi: buyurtmalar, sotuvlar, kirimlar, to'lovlar."""
        if not request.user.can_view("counterparties"):
            raise PermissionDenied()
        from apps.finance.models import Transaction
        from apps.finance.views import TransactionSerializer
        from apps.orders.serializers import OrderSerializer
        from apps.orders.views import totals, with_paid
        from apps.sales.models import Sale
        from apps.sales.serializers import SaleListSerializer
        from apps.warehouse.models import StockMove
        from apps.warehouse.views import StockMoveSerializer

        cp = self.get_object()
        orders = list(with_paid(cp.orders.select_related("client", "manager", "operator").prefetch_related("tasks__department")))
        sales = Sale.objects.filter(client=cp).select_related("client", "warehouse", "branch", "created_by")[:100]
        moves = StockMove.objects.filter(supplier=cp).select_related("material", "warehouse", "to_warehouse", "supplier", "order")[:100]
        txs = Transaction.objects.filter(Q(client=cp) | Q(supplier=cp)).select_related(
            "account", "order", "sale", "client", "supplier", "category")[:200]
        return Response({
            "notes": NoteSerializer(cp.notes.select_related("created_by")[:100], many=True).data,
            "counterparty": self.get_serializer(cp).data,
            "orders": OrderSerializer(orders, many=True).data,
            "order_totals": totals(orders),
            "sales": SaleListSerializer(sales, many=True).data,
            "moves": StockMoveSerializer(moves, many=True).data,
            "transactions": TransactionSerializer(txs, many=True).data,
        })


class GroupViewSet(viewsets.ModelViewSet):
    serializer_class = GroupSerializer
    module = "counterparties"
    public_read = True

    def get_queryset(self):
        return CounterpartyGroup.objects.annotate(count=Count("counterparties"))


class StatusViewSet(viewsets.ModelViewSet):
    serializer_class = StatusSerializer
    module = "counterparties"
    public_read = True

    def get_queryset(self):
        return CounterpartyStatus.objects.all()


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    module = "counterparties"
    filterset_fields = ["counterparty"]
    action_perms = {"create": "view"}  # izoh yozish uchun ko'rish huquqi yetarli

    def get_queryset(self):
        return CounterpartyNote.objects.select_related("created_by")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_destroy(self, instance):
        if instance.created_by_id != self.request.user.id and not self.request.user.can("counterparties", "delete"):
            raise PermissionDenied("Faqat o'z izohingizni o'chira olasiz")
        instance.delete()

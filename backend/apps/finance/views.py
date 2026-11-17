from datetime import date

from django.db.models import Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.permissions import module_perm
from apps.core.money import sum_by_currency
from apps.core.tenancy import current_branch_id

from . import services
from .models import Account, ExpenseCategory, Transaction


class AccountSerializer(serializers.ModelSerializer):
    balance = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)

    class Meta:
        model = Account
        fields = ["id", "name", "kind", "currency", "branch", "branch_name", "opening_balance", "is_active", "balance"]

    def get_balance(self, obj):
        return str(services.account_balance(obj))


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "affects_profit"]


class TransactionSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    sale_number = serializers.IntegerField(source="sale.number", read_only=True, default=None)
    client_name = serializers.CharField(source="client.name", read_only=True, default=None)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    counterparty = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id", "date", "account", "account_name", "kind", "kind_display", "direction", "amount", "currency",
            "order", "order_number", "sale", "sale_number", "order_amount", "client", "client_name", "supplier", "supplier_name",
            "category", "category_name", "description", "counterparty",
        ]
        read_only_fields = ["direction", "currency"]
        extra_kwargs = {"order_amount": {"required": False}}

    def get_counterparty(self, obj):
        return obj.client.name if obj.client_id else (obj.supplier.name if obj.supplier_id else None)

    def validate(self, attrs):
        if self.instance is None:
            instance = Transaction(**attrs)
        else:
            instance = Transaction.objects.get(pk=self.instance.pk)
            for key, value in attrs.items():
                setattr(instance, key, value)
        instance.clean()
        return attrs


class TransactionFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    unassigned = filters.BooleanFilter(field_name="order", lookup_expr="isnull")

    class Meta:
        model = Transaction
        fields = ["account", "kind", "direction", "order", "sale", "client", "supplier", "category", "currency"]


class AccountViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        qs = Account.objects.select_related("branch")
        bid = current_branch_id()
        return qs.filter(Q(branch_id=bid) | Q(branch__isnull=True)) if bid else qs

    serializer_class = AccountSerializer
    module = "finance"


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        return ExpenseCategory.objects.all()

    serializer_class = ExpenseCategorySerializer
    module = ("finance", "settings")
    public_read = True


class TransactionViewSet(viewsets.ModelViewSet):
    serializer_class = TransactionSerializer
    filterset_class = TransactionFilter
    search_fields = ["description", "client__name", "supplier__name"]
    module = "finance"

    def get_queryset(self):
        qs = Transaction.objects.select_related("account", "order", "sale", "client", "supplier", "category")
        bid = current_branch_id()
        return qs.filter(Q(account__branch_id=bid) | Q(account__branch__isnull=True)) if bid else qs

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        data = self.get_serializer(qs, many=True).data
        return Response({
            "results": data,
            "in": sum_by_currency(qs.filter(direction="in")).as_dict(),
            "out": sum_by_currency(qs.filter(direction="out")).as_dict(),
        })

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


def _period(request):
    today = timezone.localdate()
    df = request.query_params.get("date_from")
    dt = request.query_params.get("date_to")
    return (date.fromisoformat(df) if df else today.replace(month=1, day=1), date.fromisoformat(dt) if dt else today)


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def summary(request):
    """Moliya bosh sahifasi + buyurtmalar ro'yxati tepasidagi 3 kartochka."""
    return Response({
        "balances": services.balances(),
        "client_debts": services.client_debts()["total"],
        "supplier_debts": services.supplier_debts()["total"],
    })


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def client_debts(request):
    return Response(services.client_debts())


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def supplier_debts(request):
    return Response(services.supplier_debts())


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def pnl(request):
    df, dt = _period(request)
    return Response({"date_from": df, "date_to": dt, **services.profit_and_loss(df, dt)})


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def cash_flow(request):
    df, dt = _period(request)
    return Response(services.cash_flow(df, dt))

from datetime import date

from django.db.models import Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
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
    account_kind = serializers.CharField(source="account.kind", read_only=True)
    doc_type = serializers.SerializerMethodField()
    stock_doc_number = serializers.IntegerField(source="stock_doc.number", read_only=True, default=None)
    pair_account = serializers.CharField(source="pair.account.name", read_only=True, default=None)

    class Meta:
        model = Transaction
        fields = [
            "id", "number", "doc_type", "account_kind", "stock_doc", "stock_doc_number", "pair", "pair_account",
            "date", "account", "account_name", "kind", "kind_display", "direction", "amount", "currency",
            "order", "order_number", "sale", "sale_number", "order_amount", "client", "client_name", "supplier", "supplier_name",
            "category", "category_name", "description", "counterparty",
        ]
        read_only_fields = ["direction", "currency", "number", "pair"]
        extra_kwargs = {"order_amount": {"required": False}}

    def get_doc_type(self, obj):
        """MoySklad nomlari: kassa → kirim/chiqim orderi, bank → kiruvchi/chiquvchi to'lov, ko'chirish."""
        if obj.kind in (Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT):
            return "Ko'chirish"
        cash = obj.account.kind == "cash"
        if obj.direction == "in":
            return "Kirim orderi" if cash else "Kiruvchi to'lov"
        return "Chiqim orderi" if cash else "Chiquvchi to'lov"

    def get_counterparty(self, obj):
        return obj.client.name if obj.client_id else (obj.supplier.name if obj.supplier_id else None)

    def validate(self, attrs):
        if attrs.get("kind") in (Transaction.Kind.TRANSFER_IN, Transaction.Kind.TRANSFER_OUT):
            raise serializers.ValidationError({"kind": "Ko'chirish alohida amal orqali qilinadi"})
        if self.instance is not None and self.instance.pair_id:
            raise serializers.ValidationError({"detail": "Ko'chirishni tahrirlab bo'lmaydi — o'chirib qayta yarating"})
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
    counterparty = filters.NumberFilter(method="filter_cp")

    def filter_cp(self, qs, name, value):
        return qs.filter(Q(client_id=value) | Q(supplier_id=value))

    class Meta:
        model = Transaction
        fields = ["account", "kind", "direction", "order", "sale", "client", "supplier", "category", "currency", "stock_doc"]


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
    action_perms = {"transfer": "create", "open_documents": "view"}

    def get_queryset(self):
        qs = Transaction.objects.select_related("account", "order", "sale", "client", "supplier", "category", "stock_doc", "pair__account")
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

    def perform_destroy(self, instance):
        from django.db import transaction as db_tx

        with db_tx.atomic():
            pair = instance.pair or Transaction.objects.filter(pair=instance).first()
            if pair:
                Transaction.objects.filter(pk__in=[instance.pk, pair.pk]).update(pair=None)
                pair.delete()
            instance.delete()

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        """Hisoblar orasida ko'chirish (MoySklad "Перемещение"): {from_account, to_account, amount, to_amount?, date?, description?}"""
        from decimal import Decimal, InvalidOperation

        from django.db import transaction as db_tx

        from apps.core.money import RateNotFound, convert

        d = request.data
        src = Account.objects.filter(pk=d.get("from_account")).first()
        dst = Account.objects.filter(pk=d.get("to_account")).first()
        if not src or not dst or src.pk == dst.pk:
            raise serializers.ValidationError({"detail": "Ikki xil hisobni tanlang"})
        try:
            amount = Decimal(str(d.get("amount")))
        except (InvalidOperation, TypeError):
            amount = Decimal("0")
        if amount <= 0:
            raise serializers.ValidationError({"amount": "Summa musbat bo'lishi kerak"})
        day = date.fromisoformat(d["date"]) if d.get("date") else timezone.localdate()
        try:
            to_amount = Decimal(str(d["to_amount"])) if d.get("to_amount") else convert(amount, src.currency, dst.currency, day)
        except RateNotFound as e:
            raise serializers.ValidationError({"detail": str(e)})
        desc = d.get("description") or f"{src.name} → {dst.name}"
        with db_tx.atomic():
            out = Transaction.objects.create(date=day, account=src, kind=Transaction.Kind.TRANSFER_OUT, amount=amount,
                                             description=desc, created_by=request.user)
            inn = Transaction.objects.create(date=day, account=dst, kind=Transaction.Kind.TRANSFER_IN,
                                             amount=to_amount.quantize(Decimal("0.01")), description=desc,
                                             created_by=request.user, pair=out)
            out.pair = inn
            out.save(update_fields=["pair"])
        return Response(self.get_serializer(out).data, status=201)

    @action(detail=False, methods=["get"])
    def open_documents(self, request):
        """To'lanmagan hujjatlar (MoySklad "Привязать платеж"): ?counterparty=ID&direction=in|out"""
        from decimal import Decimal

        from apps.orders.models import Order
        from apps.orders.views import with_paid
        from apps.sales.models import Sale
        from apps.sales.views import with_totals
        from apps.warehouse.models import StockDoc

        cp = request.query_params.get("counterparty")
        direction = request.query_params.get("direction", "in")
        rows = []
        if not cp:
            return Response(rows)
        if direction == "in":
            for o in with_paid(Order.objects.filter(client_id=cp).exclude(status=Order.Status.CANCELLED)):
                if o.debt > 0 and not o.is_sold:
                    rows.append({"type": "order", "id": o.id, "label": f"Buyurtma №{o.number}", "date": o.date,
                                 "amount": str(o.amount), "debt": str(o.debt), "currency": o.currency})
            for s in with_totals(Sale.objects.filter(client_id=cp, status=Sale.Status.COMPLETED)):
                if s.debt > 0:
                    rows.append({"type": "sale", "id": s.id, "label": f"Sotuv №{s.number}", "date": s.date,
                                 "amount": str(s.total), "debt": str(s.debt), "currency": s.currency})
        else:
            for doc in StockDoc.objects.filter(counterparty_id=cp, type="supply", posted=True).prefetch_related("items"):
                paid = sum((p.amount for p in doc.payments.all() if p.currency == doc.currency), Decimal("0"))
                debt = doc.total - paid
                if debt > 0:
                    rows.append({"type": "supply", "id": doc.id, "label": f"Qabul qilish №{doc.number}", "date": doc.date,
                                 "amount": str(doc.total), "debt": str(debt), "currency": doc.currency})
        rows.sort(key=lambda r: r["date"])
        return Response(rows)


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
    cur = request.query_params.get("currency")
    if cur:  # MoySklad uslubi: bitta hisobot valyutasida, moddalar bo'yicha
        return Response({"date_from": df, "date_to": dt, **services.pnl_report(df, dt, cur.upper())})
    return Response({"date_from": df, "date_to": dt, **services.profit_and_loss(df, dt)})


@api_view(["GET"])
@permission_classes([module_perm("finance")])
def cash_flow(request):
    df, dt = _period(request)
    return Response(services.cash_flow(df, dt))

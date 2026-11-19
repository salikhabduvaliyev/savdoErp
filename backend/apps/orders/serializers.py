from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.core.money import q2

from .models import Estimate, EstimateMaterial, EstimateService, Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    product_code = serializers.CharField(source="product.sku", read_only=True, default=None)

    class Meta:
        model = OrderItem
        fields = ["id", "product", "product_code", "name", "unit", "qty", "price", "discount_pct", "amount"]
        read_only_fields = ["amount"]
        extra_kwargs = {"name": {"required": False, "allow_blank": True}, "unit": {"required": False}}

    def validate(self, attrs):
        if attrs.get("qty") is not None and attrs["qty"] <= 0:
            raise serializers.ValidationError({"qty": "Miqdor musbat bo'lishi kerak"})
        if attrs.get("price") is not None and attrs["price"] < 0:
            raise serializers.ValidationError({"price": "Narx manfiy bo'lmaydi"})
        if attrs.get("product") is None and not attrs.get("name"):
            raise serializers.ValidationError({"name": "Qatorda tovar yoki nom bo'lishi kerak"})
        return attrs


class OrderSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    status_display = serializers.CharField(source="state_name", read_only=True)
    state_color = serializers.CharField(source="state.color", read_only=True, default=None)
    manager_name = serializers.CharField(source="manager.full_name", read_only=True, default=None)
    operator_name = serializers.CharField(source="operator.full_name", read_only=True, default=None)
    paid = serializers.SerializerMethodField()
    debt = serializers.SerializerMethodField()
    stage = serializers.CharField(read_only=True)
    progress = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)
    is_sold = serializers.BooleanField(read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    overdue_days = serializers.IntegerField(read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "number", "date", "client", "client_name", "currency", "amount", "volume",
            "paid", "debt", "status", "state", "state_color", "status_display", "stage", "progress",
            "plan_date", "production_date", "delivered_at", "is_overdue", "overdue_days",
            "manager", "manager_name", "operator", "operator_name", "note", "is_sold", "branch", "branch_name", "extra",
            "items", "production_orders",
        ]
        read_only_fields = ["number", "delivered_at", "state"]
        extra_kwargs = {"amount": {"required": False}}

    items = OrderItemSerializer(many=True, required=False)
    production_orders = serializers.SerializerMethodField()

    def get_production_orders(self, obj):
        return [{"id": p.id, "number": p.number, "status": p.status} for p in obj.production_orders.all()
                if p.status != "cancelled"]

    def validate(self, attrs):
        items = attrs.get("items")
        has_items = bool(items) if items is not None else bool(self.instance and self.instance.items.exists())
        if not has_items:
            amount = attrs.get("amount", getattr(self.instance, "amount", None))
            if amount is None or amount <= 0:
                raise serializers.ValidationError({"amount": "Pozitsiya qo'shing yoki summani kiriting"})
        return attrs

    def _write_items(self, order, items):
        order.items.all().delete()
        for pos, it in enumerate(items):
            OrderItem.objects.create(order=order, position=pos, **it)
        if items:
            order.amount = sum((i.amount for i in order.items.all()), Decimal("0"))
            order.save(update_fields=["amount", "updated_at"])

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("items", None) or []
        if items and not validated.get("amount"):
            validated["amount"] = Decimal("0")
        order = super().create(validated)
        self._write_items(order, items)
        return order

    @transaction.atomic
    def update(self, instance, validated):
        items = validated.pop("items", None)
        order = super().update(instance, validated)
        if items is not None:
            self._write_items(order, items)
        return order

    def get_paid(self, obj):
        return str(q2(obj.paid))

    def get_debt(self, obj):
        return str(q2(obj.debt))

    def get_progress(self, obj):
        return float(round(obj.progress, 3))

    def validate_extra(self, v):
        from apps.core.custom_fields import clean_extra

        return clean_extra("order", v, partial=self.partial, existing=getattr(self.instance, "extra", None))

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError("Summa manfiy bo'lmaydi")
        return value


class EstimateMaterialSerializer(serializers.ModelSerializer):
    class Meta:
        model = EstimateMaterial
        fields = ["id", "estimate", "material", "qty", "waste_pct", "price", "currency"]
        read_only_fields = ["currency"]
        extra_kwargs = {"price": {"required": False}}

    def validate(self, attrs):
        if "price" not in attrs and self.instance is None:
            stock = attrs["material"].stocks.order_by("-qty").first()
            attrs["price"] = stock.avg_cost if stock else Decimal("0")
        return attrs


class EstimateServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = EstimateService
        fields = ["id", "estimate", "operation", "qty", "rate", "currency"]
        extra_kwargs = {"rate": {"required": False}, "currency": {"required": False}}

    def validate(self, attrs):
        if self.instance is None:
            op = attrs["operation"]
            attrs.setdefault("rate", op.default_rate)
            attrs.setdefault("currency", op.rate_currency)
        return attrs


class EstimateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Estimate
        fields = ["id", "order", "version", "is_active", "note", "created_at"]
        read_only_fields = ["version", "is_active"]

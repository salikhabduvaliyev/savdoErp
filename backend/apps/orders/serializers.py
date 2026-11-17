from decimal import Decimal

from rest_framework import serializers

from apps.core.money import q2

from .models import Estimate, EstimateMaterial, EstimateService, Order


class OrderSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
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
            "paid", "debt", "status", "status_display", "stage", "progress",
            "plan_date", "production_date", "delivered_at", "is_overdue", "overdue_days",
            "manager", "manager_name", "operator", "operator_name", "note", "is_sold", "branch", "branch_name", "extra",
        ]
        read_only_fields = ["number", "delivered_at"]

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
        if value <= 0:
            raise serializers.ValidationError("Summa musbat bo'lishi kerak")
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

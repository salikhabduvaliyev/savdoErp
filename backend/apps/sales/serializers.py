from django.db import transaction
from rest_framework import serializers

from apps.core.money import q2

from .models import Sale, SaleItem


class SaleItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)

    class Meta:
        model = SaleItem
        fields = ["id", "product", "product_name", "order", "order_number", "name", "unit", "qty", "price",
                  "discount_pct", "amount", "cost_amount"]
        read_only_fields = ["amount", "cost_amount", "order"]
        extra_kwargs = {"name": {"required": False, "allow_blank": True}, "unit": {"required": False}}

    def validate(self, attrs):
        if attrs.get("qty") is not None and attrs["qty"] <= 0:
            raise serializers.ValidationError({"qty": "Miqdor musbat bo'lishi kerak"})
        if attrs.get("price") is not None and attrs["price"] < 0:
            raise serializers.ValidationError({"price": "Narx manfiy bo'lmaydi"})
        return attrs


class SaleListSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    seller_name = serializers.CharField(source="seller.full_name", read_only=True, default=None)
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    total = serializers.SerializerMethodField()
    paid = serializers.SerializerMethodField()
    debt = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = ["id", "number", "date", "client", "client_name", "branch", "branch_name", "warehouse", "warehouse_name",
                  "currency", "status", "status_display", "order", "order_number", "discount", "total", "paid", "debt",
                  "seller", "seller_name", "note", "completed_at", "extra"]

    def validate_extra(self, v):
        from apps.core.custom_fields import clean_extra

        return clean_extra("sale", v, partial=self.partial, existing=getattr(self.instance, "extra", None))

    def get_total(self, obj):
        return str(q2(obj.total))

    def get_paid(self, obj):
        return str(q2(obj.paid))

    def get_debt(self, obj):
        return str(q2(obj.debt))


class SaleSerializer(SaleListSerializer):
    items = SaleItemSerializer(many=True)
    price_type_name = serializers.CharField(source="price_type.name", read_only=True, default=None)
    cost = serializers.SerializerMethodField()

    class Meta(SaleListSerializer.Meta):
        fields = SaleListSerializer.Meta.fields + ["price_type", "price_type_name", "items", "cost"]
        read_only_fields = ["status", "order", "completed_at"]

    def get_cost(self, obj):
        return str(q2(obj.cost)) if obj.status == Sale.Status.COMPLETED else None

    def validate(self, attrs):
        if self.instance and self.instance.status != Sale.Status.DRAFT:
            raise serializers.ValidationError("Yakunlangan yoki bekor qilingan sotuvni o'zgartirib bo'lmaydi")
        if self.instance and self.instance.order_id and "currency" in attrs and attrs["currency"] != self.instance.currency:
            raise serializers.ValidationError({"currency": "Buyurtmadan sotuvda valyuta buyurtma valyutasi bilan bir xil"})
        return attrs

    def _write_items(self, sale, items):
        keep_order_lines = list(sale.items.filter(order__isnull=False))
        sale.items.filter(order__isnull=True).delete()
        pos = len(keep_order_lines)
        for it in items:
            if it.get("product") is None and not it.get("name"):
                raise serializers.ValidationError({"items": "Qatorda tovar yoki nom bo'lishi kerak"})
            SaleItem.objects.create(sale=sale, position=pos, **it)
            pos += 1

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("items", [])
        sale = Sale.objects.create(**validated)
        self._write_items(sale, items)
        return sale

    @transaction.atomic
    def update(self, instance, validated):
        items = validated.pop("items", None)
        sale = super().update(instance, validated)
        if items is not None:
            self._write_items(sale, items)
        return sale

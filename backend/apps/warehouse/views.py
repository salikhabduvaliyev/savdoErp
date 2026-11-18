from decimal import Decimal

from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import mixins, serializers, viewsets
from rest_framework.response import Response

from apps.core.money import MoneyBag
from apps.core.tenancy import current_branch_id

from .models import Material, MaterialGroup, PriceType, ProductPrice, Stock, StockMove, Warehouse
from .services import post_move

STATE_LABELS = {"ok": "Yetarli", "near_min": "Minimalga yaqin", "low": "Kam"}


def _protected_destroy(instance, msg):
    try:
        instance.delete()
    except ProtectedError:
        raise serializers.ValidationError(msg)


class WarehouseSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)

    class Meta:
        model = Warehouse
        fields = ["id", "name", "branch", "branch_name", "is_active"]


class MaterialGroupSerializer(serializers.ModelSerializer):
    products_count = serializers.SerializerMethodField()

    class Meta:
        model = MaterialGroup
        fields = ["id", "name", "parent", "products_count"]

    def get_products_count(self, obj):
        return obj.material_set.count()

    def validate_parent(self, parent):
        if parent and self.instance:
            if parent.id in self.instance.descendant_ids():
                raise serializers.ValidationError("Guruhni o'zining ichiga joylab bo'lmaydi")
        return parent


class PriceTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PriceType
        fields = ["id", "name", "currency", "is_default"]


class ProductSerializer(serializers.ModelSerializer):
    """Tovar: narxlar `prices: {price_type_id: narx}` ko'rinishida o'qiladi va yoziladi."""

    unit_display = serializers.CharField(source="get_unit_display", read_only=True)
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    group_name = serializers.CharField(source="group.name", read_only=True, default=None)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    prices = serializers.DictField(child=serializers.DecimalField(max_digits=18, decimal_places=2, allow_null=True),
                                   required=False, write_only=True)
    stock_qty = serializers.SerializerMethodField()
    avg_cost = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = ["id", "name", "type", "type_display", "code", "sku", "barcode", "group", "group_name", "supplier",
                  "supplier_name", "unit", "unit_display", "currency", "purchase_price", "min_price", "min_price_currency",
                  "weight", "volume", "min_qty", "description", "is_active", "prices", "stock_qty", "avg_cost",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {"code": {"required": False, "allow_blank": True}}

    def validate_code(self, v):
        v = (v or "").strip()
        if v and Material.objects.filter(code=v).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("Bunday kodli tovar bor")
        return v

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data["prices"] = {str(p.price_type_id): str(p.price) for p in obj.prices.all()}
        return data

    def get_stock_qty(self, obj):
        if not obj.is_stocked:
            return None
        return str(sum((s.qty for s in obj.stocks.all()), Decimal("0")))

    def get_avg_cost(self, obj):
        stocks = [s for s in obj.stocks.all() if s.qty > 0]
        qty = sum((s.qty for s in stocks), Decimal("0"))
        if not qty:
            return None
        return str((sum((s.qty * s.avg_cost for s in stocks), Decimal("0")) / qty).quantize(Decimal("0.01")))

    @transaction.atomic
    def _save_prices(self, product, prices):
        if prices is None:
            return
        valid = set(PriceType.objects.values_list("id", flat=True))
        for pt_id, price in prices.items():
            pt_id = int(pt_id)
            if pt_id not in valid:
                continue
            if price in (None, ""):
                ProductPrice.objects.filter(product=product, price_type_id=pt_id).delete()
            else:
                ProductPrice.objects.update_or_create(product=product, price_type_id=pt_id, defaults={"price": price})

    def create(self, validated):
        prices = validated.pop("prices", None)
        obj = super().create(validated)
        self._save_prices(obj, prices)
        return obj

    def update(self, instance, validated):
        prices = validated.pop("prices", None)
        obj = super().update(instance, validated)
        self._save_prices(obj, prices)
        return obj


class StockSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_type = serializers.CharField(source="material.type", read_only=True)
    unit = serializers.CharField(source="material.get_unit_display", read_only=True)
    group = serializers.IntegerField(source="material.group_id", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    currency = serializers.CharField(source="material.currency", read_only=True)
    min_qty = serializers.DecimalField(source="material.min_qty", max_digits=14, decimal_places=3, read_only=True)
    available = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)
    value = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    state = serializers.SerializerMethodField()
    state_display = serializers.SerializerMethodField()

    class Meta:
        model = Stock
        fields = ["id", "material", "material_name", "material_type", "unit", "group", "warehouse", "warehouse_name",
                  "qty", "reserved", "available", "min_qty", "avg_cost", "currency", "value", "state", "state_display"]

    def _ratio(self):
        if "ratio" not in self.context:
            from apps.core.models import SystemSettings

            self.context["ratio"] = SystemSettings.load().stock_near_min_ratio
        return self.context["ratio"]

    def get_state(self, obj):
        return obj.state_for(self._ratio())

    def get_state_display(self, obj):
        return STATE_LABELS[obj.state_for(self._ratio())]


class StockMoveSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    unit = serializers.CharField(source="material.get_unit_display", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    to_warehouse_name = serializers.CharField(source="to_warehouse.name", read_only=True, default=None)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    order_number = serializers.IntegerField(source="order.number", read_only=True, default=None)
    sale_number = serializers.IntegerField(source="sale.number", read_only=True, default=None)
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)

    class Meta:
        model = StockMove
        fields = ["id", "date", "type", "type_display", "material", "material_name", "unit", "warehouse", "warehouse_name",
                  "to_warehouse", "to_warehouse_name", "qty", "price", "currency", "amount", "supplier", "supplier_name",
                  "order", "order_number", "sale", "sale_number", "note", "created_at"]
        read_only_fields = ["currency", "sale"]
        extra_kwargs = {"price": {"required": False}}

    def validate(self, attrs):
        if attrs["type"] == StockMove.Type.IN and not attrs.get("price"):
            raise serializers.ValidationError({"price": "Kirim narxini kiriting"})
        if not attrs["material"].is_stocked:
            raise serializers.ValidationError({"material": "Xizmat omborda hisobga olinmaydi"})
        return attrs


class WarehouseViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    module = ("company", "warehouse")
    public_read = True

    def get_queryset(self):
        qs = Warehouse.objects.select_related("branch")
        bid = current_branch_id()
        return qs.filter(branch_id=bid) if bid else qs

    def perform_create(self, serializer):
        if serializer.validated_data.get("branch"):
            serializer.save()
        else:
            serializer.save(branch_id=current_branch_id())

    def perform_destroy(self, instance):
        _protected_destroy(instance, "Omborda harakatlar bor — o'chirib bo'lmaydi, nofaol qiling")


class MaterialGroupViewSet(viewsets.ModelViewSet):
    serializer_class = MaterialGroupSerializer
    module = ("products", "settings")
    public_read = True

    def get_queryset(self):
        return MaterialGroup.objects.all()

    def perform_destroy(self, instance):
        if instance.children.exists():
            raise serializers.ValidationError({"detail": "Guruh ichida boshqa guruhlar bor — avval ularni ko'chiring"})
        _protected_destroy(instance, "Guruhni o'chirib bo'lmaydi")


class PriceTypeViewSet(viewsets.ModelViewSet):
    serializer_class = PriceTypeSerializer
    module = ("products", "settings")
    public_read = True

    def get_queryset(self):
        return PriceType.objects.all()

    def perform_save(self, serializer):
        obj = serializer.save()
        if obj.is_default:
            PriceType.objects.exclude(pk=obj.pk).update(is_default=False)

    perform_create = perform_save
    perform_update = perform_save


class ProductViewSet(viewsets.ModelViewSet):
    """Tovarlar (nomenklatura). ?type=raw,product  ?for_sale=1 (xomashyosiz)"""

    serializer_class = ProductSerializer
    search_fields = ["name", "sku", "barcode", "code"]
    filterset_fields = ["currency", "is_active", "supplier"]
    module = "products"
    public_read = True

    def get_queryset(self):
        qs = Material.objects.select_related("group", "supplier").prefetch_related("prices", "stocks")
        g = self.request.query_params.get("group")
        if g == "none":
            qs = qs.filter(group__isnull=True)
        elif g:
            grp = MaterialGroup.objects.filter(pk=g).first()
            qs = qs.filter(group_id__in=grp.descendant_ids()) if grp else qs.none()
        t = self.request.query_params.get("type")
        if t:
            qs = qs.filter(type__in=t.split(","))
        if self.request.query_params.get("for_sale") in ("1", "true"):
            qs = qs.exclude(type=Material.Type.RAW)
        return qs

    def perform_destroy(self, instance):
        _protected_destroy(instance, "Tovar hujjatlarda ishlatilgan — o'chirib bo'lmaydi, nofaol qiling")


class StockViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockSerializer
    filterset_fields = ["warehouse", "material", "material__group", "material__type"]
    search_fields = ["material__name", "material__sku"]
    module = ("warehouse", "products")

    def get_queryset(self):
        qs = Stock.objects.select_related("material__group", "warehouse")
        bid = current_branch_id()
        return qs.filter(warehouse__branch_id=bid) if bid else qs

    def list(self, request, *args, **kwargs):
        from apps.core.models import SystemSettings

        ratio = SystemSettings.load().stock_near_min_ratio
        rows = list(self.filter_queryset(self.get_queryset()))
        if request.query_params.get("below_min") in ("1", "true"):
            rows = [r for r in rows if r.state_for(ratio) != "ok"]
        bag = MoneyBag()
        for r in rows:
            bag.add(r.value, r.material.currency)
        ser = self.get_serializer(rows, many=True)
        ser.context["ratio"] = ratio
        return Response({"results": ser.data, "total_value": bag.as_dict()})


class StockMoveViewSet(mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Harakatlar o'zgartirilmaydi — xato bo'lsa, teskari harakat (tuzatma) kiritiladi."""

    serializer_class = StockMoveSerializer
    filterset_fields = ["type", "material", "warehouse", "order", "supplier", "sale"]
    module = "warehouse"

    def get_queryset(self):
        qs = StockMove.objects.select_related("material", "warehouse", "to_warehouse", "supplier", "order", "sale")
        bid = current_branch_id()
        return qs.filter(warehouse__branch_id=bid) if bid else qs

    def perform_create(self, serializer):
        move = StockMove(**serializer.validated_data, created_by=self.request.user)
        if move.price is None:
            move.price = Decimal("0")
        serializer.instance = post_move(move)


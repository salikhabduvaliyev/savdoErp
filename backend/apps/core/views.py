from django.db.models import ProtectedError
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import TenantUser, module_perm

from .models import Branch, Company, Currency, CustomField, ExchangeRate, SystemSettings
from .money import RateNotFound, get_rate


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = ["id", "date", "usd_uzs", "source"]

    def validate_usd_uzs(self, v):
        if v <= 0:
            raise serializers.ValidationError("Kurs musbat bo'lishi kerak")
        return v


class ExchangeRateViewSet(viewsets.ModelViewSet):
    serializer_class = ExchangeRateSerializer
    module = ("settings", "finance")
    public_read = True

    def get_queryset(self):
        return ExchangeRate.objects.all()


class CustomFieldSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    entity_display = serializers.CharField(source="get_entity_display", read_only=True)

    class Meta:
        model = CustomField
        fields = ["id", "entity", "entity_display", "key", "name", "type", "type_display", "options", "required",
                  "show_in_list", "filterable", "position"]
        extra_kwargs = {"key": {"required": False}}

    def validate(self, attrs):
        import re

        from django.utils.text import slugify

        if not attrs.get("key") and not self.instance:
            base = slugify(attrs.get("name", ""), allow_unicode=False).replace("-", "_") or "field"
            key, i = base[:40], 1
            while CustomField.objects.filter(entity=attrs["entity"], key=key).exists():
                i += 1
                key = f"{base[:36]}_{i}"
            attrs["key"] = key
        if attrs.get("key") and not re.fullmatch(r"[a-z0-9_]+", attrs["key"]):
            raise serializers.ValidationError({"key": "Faqat lotin kichik harflar, raqam va _"})
        opts = attrs.get("options")
        if opts is not None and not isinstance(opts, list):
            raise serializers.ValidationError({"options": "Ro'yxat bo'lishi kerak"})
        if attrs.get("type", getattr(self.instance, "type", None)) == "select" and not (opts or getattr(self.instance, "options", None)):
            raise serializers.ValidationError({"options": "Tanlash uchun variantlarni kiriting"})
        return attrs


class CustomFieldViewSet(viewsets.ModelViewSet):
    serializer_class = CustomFieldSerializer
    module = "settings"
    public_read = True
    filterset_fields = ["entity"]

    def get_queryset(self):
        return CustomField.objects.all()


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "address", "phone", "is_main", "is_active"]


class BranchViewSet(viewsets.ModelViewSet):
    serializer_class = BranchSerializer
    module = "company"
    public_read = True

    def get_queryset(self):
        return Branch.objects.all()

    def perform_save(self, serializer):
        obj = serializer.save()
        if obj.is_main:
            Branch.objects.exclude(pk=obj.pk).update(is_main=False)

    perform_create = perform_save
    perform_update = perform_save

    def perform_destroy(self, instance):
        if instance.is_main:
            raise serializers.ValidationError("Bosh filialni o'chirib bo'lmaydi")
        try:
            instance.delete()
        except ProtectedError:
            raise serializers.ValidationError("Filialda hujjatlar bor — o'chirib bo'lmaydi, nofaol qiling")


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ["name", "legal_name", "inn", "oked", "vat_code", "director", "accountant", "address", "phone", "email",
                  "website", "bank_name", "bank_mfo", "bank_account", "logo", "status", "trial_ends", "paid_until"]
        read_only_fields = ["status", "trial_ends", "paid_until"]


class SystemSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSettings
        exclude = ["id", "company"]

    def validate_stock_near_min_ratio(self, v):
        if v < 1:
            raise serializers.ValidationError("Koeffitsiyent 1 dan kichik bo'lmasligi kerak")
        return v


@api_view(["GET", "PATCH"])
@permission_classes([module_perm("company", public_read=True)])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def company(request):
    obj = request.user.company
    if request.method == "PATCH":
        s = CompanySerializer(obj, data=request.data, partial=True, context={"request": request})
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    return Response(CompanySerializer(obj, context={"request": request}).data)


@api_view(["GET", "PATCH"])
@permission_classes([module_perm("settings", public_read=True)])
def system_settings(request):
    obj = SystemSettings.load()
    if request.method == "PATCH":
        s = SystemSettingsSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    return Response(SystemSettingsSerializer(obj).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def public_info(request):
    """Login sahifasi uchun (tizimga kirmasdan)."""
    return Response({"name": "Akfa ERP", "trial_days": Company.TRIAL_DAYS})


@api_view(["GET"])
@permission_classes([TenantUser])
def meta(request):
    """Frontend uchun spravochniklar: valyutalar, joriy kurs."""
    try:
        rate = str(get_rate())
    except RateNotFound:
        rate = None
    from apps.orders.models import Order
    from apps.sales.models import Sale

    return Response({
        "currencies": [{"value": v, "label": l} for v, l in Currency.choices],
        "usd_rate": rate,
        "order_statuses": [{"value": v, "label": l} for v, l in Order.Status.choices],
        "sale_statuses": [{"value": v, "label": l} for v, l in Sale.Status.choices],
        "default_currency": SystemSettings.load().default_currency,
    })

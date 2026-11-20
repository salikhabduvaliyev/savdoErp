from django.db.models import ProtectedError
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import TenantUser, module_perm

from .models import BASE_CURRENCY, Branch, Company, Currency, CurrencyDef, CustomField, ExchangeRate, SystemSettings
from .money import RateNotFound, get_rate


class ExchangeRateSerializer(serializers.ModelSerializer):
    rate = serializers.DecimalField(source="usd_uzs", max_digits=14, decimal_places=4, required=False)

    class Meta:
        model = ExchangeRate
        fields = ["id", "currency", "date", "usd_uzs", "rate", "source"]
        extra_kwargs = {"usd_uzs": {"required": False}, "source": {"required": False}}

    def validate(self, attrs):
        v = attrs.get("usd_uzs")
        if v is None and not self.instance:
            raise serializers.ValidationError({"rate": "Kursni kiriting"})
        if v is not None and v <= 0:
            raise serializers.ValidationError({"rate": "Kurs musbat bo'lishi kerak"})
        cur = attrs.get("currency", getattr(self.instance, "currency", "USD"))
        if cur == "UZS":
            raise serializers.ValidationError({"currency": "Asosiy valyuta kursi doim 1"})
        if not self.instance and "source" not in attrs:
            attrs["source"] = "qo'lda"
        qs = ExchangeRate.objects.filter(currency=cur, date=attrs.get("date", getattr(self.instance, "date", None)))
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"date": "Bu sana uchun kurs allaqachon bor — uni tahrirlang"})
        return attrs


class ExchangeRateViewSet(viewsets.ModelViewSet):
    """Kurslar tarixi. ?currency=USD"""

    serializer_class = ExchangeRateSerializer
    module = ("settings", "finance")
    public_read = True
    filterset_fields = ["currency"]

    def get_queryset(self):
        return ExchangeRate.objects.all()


class CurrencyDefSerializer(serializers.ModelSerializer):
    rate = serializers.SerializerMethodField()
    rate_date = serializers.SerializerMethodField()
    rate_source = serializers.SerializerMethodField()
    base_rate = serializers.SerializerMethodField()

    class Meta:
        model = CurrencyDef
        fields = ["id", "code", "name", "symbol", "is_base", "auto_update", "is_active", "position",
                  "rate", "rate_date", "rate_source", "base_rate"]
        read_only_fields = ["is_base"]

    def _last(self, obj):
        if not hasattr(obj, "_last_rate"):
            obj._last_rate = None if obj.code == BASE_CURRENCY else ExchangeRate.objects.filter(currency=obj.code).order_by("-date").first()
        return obj._last_rate

    def get_rate(self, obj):
        """1 birlik = necha so'm (kurslar so'mga nisbatan saqlanadi — CBU)."""
        if obj.code == BASE_CURRENCY:
            return "1"
        r = self._last(obj)
        return str(r.usd_uzs) if r else None

    def get_base_rate(self, obj):
        """1 birlik = necha asosiy valyuta (asosiy valyuta so'm bo'lmasa)."""
        from decimal import Decimal

        from .currency import company_base_currency
        from .money import RateNotFound, convert

        base = self.context.setdefault("base_currency", company_base_currency())
        if base == BASE_CURRENCY or obj.code == base:
            return None
        try:
            return str(convert(Decimal("1"), obj.code, base).quantize(Decimal("0.000001")).normalize())
        except RateNotFound:
            return None

    def get_rate_date(self, obj):
        r = self._last(obj)
        return r.date if r else None

    def get_rate_source(self, obj):
        r = self._last(obj)
        return r.source if r else None

    def validate_code(self, v):
        import re

        v = (v or "").upper().strip()
        if not re.fullmatch(r"[A-Z]{3}", v):
            raise serializers.ValidationError("Kod 3 ta lotin harfi (masalan EUR)")
        qs = CurrencyDef.objects.filter(code=v)
        if self.instance:
            if self.instance.code != v and (self.instance.is_base or self.instance.code == BASE_CURRENCY):
                raise serializers.ValidationError("Asosiy valyuta kodini o'zgartirib bo'lmaydi")
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Bunday valyuta bor")
        return v


class CurrencyDefViewSet(viewsets.ModelViewSet):
    """Valyutalar ma'lumotnomasi. Ro'yxat ochilganda CBU kurslari kuniga bir marta yangilanadi."""

    serializer_class = CurrencyDefSerializer
    module = ("settings", "finance")
    public_read = True

    def get_queryset(self):
        return CurrencyDef.objects.all()

    def list(self, request, *args, **kwargs):
        from .currency import auto_update_once_a_day, ensure_default_currencies

        ensure_default_currencies()
        auto_update_once_a_day()
        return super().list(request, *args, **kwargs)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError

        if instance.is_base or instance.code in ("UZS", "USD"):
            raise ValidationError("Asosiy valyutani va so'm/USD'ni o'chirib bo'lmaydi — nofaol qiling")
        instance.delete()

    @action(detail=True, methods=["post"])
    def make_base(self, request, pk=None):
        """Kompaniyaning asosiy (hisob) valyutasini belgilash: hisobotlar va yangi hujjatlar shu valyutada.
        Kurslar o'zgarmaydi — ular so'mga nisbatan saqlanadi va kross-kurs orqali hisoblanadi."""
        from django.db import transaction

        cur = self.get_object()
        with transaction.atomic():
            CurrencyDef.objects.exclude(pk=cur.pk).filter(is_base=True).update(is_base=False)
            cur.is_base = True
            cur.is_active = True
            cur.save(update_fields=["is_base", "is_active"])
            st = SystemSettings.load()
            st.default_currency = cur.code
            st.save(update_fields=["default_currency"])
        return Response(self.get_serializer(cur).data)

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """CBU'dan kurslarni hozir yangilash (?codes=USD,EUR)."""
        from .currency import update_rates

        codes = request.data.get("codes") or None
        return Response(update_rates(codes=codes, force=True))

    @action(detail=False, methods=["get"])
    def cbu(self, request):
        """CBU valyutalari ro'yxati — yangi valyuta qo'shishda tanlash uchun."""
        from .currency import cbu_currencies

        try:
            return Response(cbu_currencies())
        except Exception as e:
            return Response({"detail": f"CBU bilan aloqa yo'q: {e}"}, status=503)


class CustomFieldSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    entity_display = serializers.CharField(source="get_entity_display", read_only=True)

    class Meta:
        model = CustomField
        fields = ["id", "entity", "entity_display", "key", "name", "type", "type_display", "options", "required",
                  "show_in_list", "filterable", "main", "position"]
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
        if s.instance.production_without_stock:
            # ruxsat yoqildi — "Material yo'q" bilan to'xtagan bosqichlar qayta navbatga
            from apps.production.models import ProductionTask

            ProductionTask.objects.filter(status=ProductionTask.Status.BLOCKED).update(
                status=ProductionTask.Status.WAITING, blocked_reason="")
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
        "currencies": [{"value": c.code, "label": c.symbol or c.code, "name": c.name}
                       for c in CurrencyDef.objects.filter(is_active=True)] or [{"value": v, "label": l} for v, l in Currency.choices],
        "usd_rate": rate,
        "order_statuses": [{"value": v, "label": l} for v, l in Order.Status.choices],
        "sale_statuses": [{"value": v, "label": l} for v, l in Sale.Status.choices],
        "default_currency": SystemSettings.load().default_currency,
    })


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        from .models import AuditLog

        model = AuditLog
        fields = ["id", "created_at", "user", "user_name", "action", "action_display", "entity", "entity_id", "title", "changes"]

    def get_user_name(self, obj):
        return obj.user.full_name if obj.user else None


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Kompaniya tarixi. ?entity=production_order&entity_id=1&user=&action=&date_from=&date_to=&search="""

    serializer_class = AuditLogSerializer
    module = ("company", "settings", "production")

    def get_queryset(self):
        from .models import AuditLog

        qs = AuditLog.objects.select_related("user")
        p = self.request.query_params
        for f in ("entity", "entity_id", "user", "action"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=p["date_to"])
        if p.get("search"):
            qs = qs.filter(title__icontains=p["search"])
        return qs[:2000]

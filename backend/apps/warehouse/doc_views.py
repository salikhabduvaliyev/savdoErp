"""Hujjatlar API: /api/warehouse/docs/?type=supply  (MoySklad: Приёмки, Оприходования, Списания …)."""
from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q, Sum
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import module_perm
from apps.core.money import MoneyBag, q2
from apps.core.tenancy import current_branch_id

from . import documents as D
from .models import Material, Stock, StockDoc, StockDocItem, StockMove

T = StockDoc.Type


def _err(e):
    if isinstance(e, DjangoValidationError):
        return ValidationError({"detail": "; ".join(e.messages)})
    return e


class StockDocItemSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_code = serializers.CharField(source="material.sku", read_only=True)
    unit = serializers.CharField(source="material.get_unit_display", read_only=True)

    class Meta:
        model = StockDocItem
        fields = ["id", "material", "material_name", "material_code", "unit", "qty", "book_qty", "price",
                  "discount_pct", "amount"]
        read_only_fields = ["amount", "book_qty"]
        extra_kwargs = {"price": {"required": False}}

    def validate(self, attrs):
        if attrs.get("qty") is not None and attrs["qty"] < 0:
            raise serializers.ValidationError({"qty": "Miqdor manfiy bo'lmaydi"})
        return attrs


class StockDocListSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True, default=None)
    to_warehouse_name = serializers.CharField(source="to_warehouse.name", read_only=True, default=None)
    counterparty_name = serializers.CharField(source="counterparty.name", read_only=True, default=None)
    source_number = serializers.IntegerField(source="source.number", read_only=True, default=None)
    source_type = serializers.CharField(source="source.type", read_only=True, default=None)
    sale_number = serializers.IntegerField(source="sale.number", read_only=True, default=None)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    total = serializers.SerializerMethodField()
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = StockDoc
        fields = ["id", "type", "type_display", "number", "date", "warehouse", "warehouse_name", "to_warehouse",
                  "to_warehouse_name", "counterparty", "counterparty_name", "currency", "posted", "plan_date", "source",
                  "source_number", "source_type", "sale", "sale_number", "note", "extra", "total", "items_count",
                  "created_by_name", "created_at"]
        read_only_fields = ["number"]

    def get_total(self, obj):
        return str(q2(sum((i.amount for i in obj.items.all()), Decimal("0"))))

    def get_items_count(self, obj):
        return len(obj.items.all())


class StockDocSerializer(StockDocListSerializer):
    items = StockDocItemSerializer(many=True, required=False)

    class Meta(StockDocListSerializer.Meta):
        fields = StockDocListSerializer.Meta.fields + ["items"]

    def validate(self, attrs):
        if self.instance and "type" in attrs and attrs["type"] != self.instance.type:
            raise serializers.ValidationError({"type": "Hujjat turini o'zgartirib bo'lmaydi"})
        return attrs

    def _items(self, raw, doc):
        rows = []
        for it in raw:
            m = it["material"]
            if "price" not in it or it["price"] is None:
                # tovar narxi o'z valyutasida — hujjat valyutasiga hujjat sanasidagi kurs bo'yicha
                from apps.core.money import RateNotFound, convert

                base = m.purchase_price if doc.type in (T.SUPPLY, T.PURCHASE_ORDER, T.ENTER, T.PURCHASE_RETURN) else Decimal("0")
                try:
                    it["price"] = convert(base, m.currency, doc.currency, doc.date).quantize(Decimal("0.0001"))
                except RateNotFound as e:
                    raise serializers.ValidationError({"items": str(e)})
            rows.append(it)
        return rows

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("items", [])
        want_post = validated.get("posted", True)
        validated["posted"] = False
        doc = StockDoc.objects.create(**validated)
        D.write_items(doc, self._items(items, doc))
        if want_post or doc.type not in D.STOCK_TYPES:
            if doc.type in D.STOCK_TYPES:
                D.post_doc(doc)
            else:
                doc.posted = want_post
                doc.save(update_fields=["posted"])
        return doc

    @transaction.atomic
    def update(self, doc, validated):
        items = validated.pop("items", None)
        want_post = validated.pop("posted", None)
        was_posted = doc.moves.exists()
        if was_posted:
            D.unpost_doc(doc)
            doc.refresh_from_db()
        for k, v in validated.items():
            setattr(doc, k, v)
        doc.save()
        if items is not None:
            D.write_items(doc, self._items(items, doc))
        post = was_posted if want_post is None else want_post
        if doc.type in D.STOCK_TYPES:
            if post:
                D.post_doc(doc)
        elif want_post is not None:
            doc.posted = want_post
            doc.save(update_fields=["posted"])
        return doc


def _module_for(t):
    return StockDoc.MODULE.get(t)


NO_PRICE_TYPES = {"loss", "move", "inventory"}


class StockDocViewSet(viewsets.ModelViewSet):
    """?type=supply&warehouse=&counterparty=&posted=&date_from=&date_to=&search="""

    serializer_class = StockDocSerializer
    action_perms = {"post": "post", "unpost": "post", "derive": "view", "from_sale": "view", "import_template": "view", "import_items": "view"}

    @property
    def module(self):
        t = self.request.query_params.get("type") or (self.request.data.get("type") if hasattr(self.request, "data") else None)
        m = _module_for(t)
        return m or tuple(sorted(set(StockDoc.MODULE.values())))

    def get_serializer_class(self):
        return StockDocListSerializer if self.action == "list" else StockDocSerializer

    def get_queryset(self):
        qs = StockDoc.objects.select_related("warehouse", "to_warehouse", "counterparty", "source", "sale", "created_by") \
            .prefetch_related("items__material")
        p = self.request.query_params
        if p.get("type"):
            qs = qs.filter(type__in=p["type"].split(","))
        for f in ("warehouse", "counterparty", "source", "sale"):
            if p.get(f):
                qs = qs.filter(**{f"{f}_id": p[f]})
        if p.get("posted") in ("1", "true", "0", "false"):
            qs = qs.filter(posted=p["posted"] in ("1", "true"))
        if p.get("date_from"):
            qs = qs.filter(date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(date__lte=p["date_to"])
        if p.get("material"):
            qs = qs.filter(items__material_id=p["material"]).distinct()
        if p.get("search"):
            s = p["search"].strip()
            q = Q(note__icontains=s) | Q(counterparty__name__icontains=s)
            if s.isdigit():
                q |= Q(number=int(s))
            qs = qs.filter(q)
        bid = current_branch_id()
        if bid:
            qs = qs.filter(Q(branch_id=bid) | Q(warehouse__branch_id=bid) | Q(branch__isnull=True, warehouse__isnull=True))
        return qs

    @action(detail=False, methods=["get"])
    def import_template(self, request):
        """Import shabloni (xlsx): 1-varaq — to'ldiriladigan jadval, 2-varaq — tovarlar ma'lumotnomasi."""
        from .excel import template_response

        t = request.query_params.get("type") or "enter"
        mats = list(Material.objects.filter(is_active=True).exclude(type=Material.Type.SERVICE).order_by("name"))
        return template_response(t, mats, with_price=t not in NO_PRICE_TYPES)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def import_items(self, request):
        """Excel/CSV'dan pozitsiyalar: {lines, errors}. Hujjat saqlanmaydi — forma to'ldiriladi."""
        from .excel import parse_items

        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "Fayl tanlanmagan"}, status=400)
        if f.size > 5 * 1024 * 1024:
            return Response({"detail": "Fayl juda katta (5 MB gacha)"}, status=400)
        t = request.query_params.get("type") or "enter"
        try:
            lines, errors = parse_items(f, Material.objects.exclude(type=Material.Type.SERVICE), with_price=t not in NO_PRICE_TYPES)
        except Exception as e:  # noqa: BLE001 — buzilgan fayl
            return Response({"detail": f"Faylni o'qib bo'lmadi: {e}"}, status=400)
        return Response({"lines": lines, "errors": errors})

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        from apps.accounts.permissions import required_action

        act = required_action(request, self)
        if act == "post":
            act = "post"
        if not request.user.can(_module_for(obj.type), act):
            raise PermissionDenied("Bu hujjat turi uchun huquqingiz yo'q")

    def list(self, request, *args, **kwargs):
        rows = list(self.filter_queryset(self.get_queryset()))
        totals = MoneyBag()
        for d in rows:
            totals.add(sum((i.amount for i in d.items.all()), Decimal("0")), d.currency)
        return Response({"count": len(rows), "results": self.get_serializer(rows, many=True).data, "totals": totals.as_dict()})

    def perform_create(self, serializer):
        t = serializer.validated_data.get("type")
        if not t:
            raise ValidationError({"type": "Hujjat turi kerak"})
        if not self.request.user.can(_module_for(t), "create"):
            raise PermissionDenied("Bu hujjat turi uchun huquqingiz yo'q")
        extra = {}
        if serializer.validated_data.get("posted", True) and not self.request.user.can(_module_for(t), "post"):
            extra["posted"] = False  # o'tkazish huquqi yo'q — qoralama sifatida saqlanadi
        try:
            serializer.save(created_by=self.request.user, branch_id=current_branch_id(), **extra)
        except DjangoValidationError as e:
            raise _err(e)

    def perform_update(self, serializer):
        if "posted" in serializer.validated_data and not self.request.user.can(_module_for(serializer.instance.type), "post"):
            raise PermissionDenied("Hujjatni o'tkazish huquqi yo'q")
        try:
            serializer.save()
        except DjangoValidationError as e:
            raise _err(e)

    @transaction.atomic
    def perform_destroy(self, doc):
        if doc.derived.exists():
            raise ValidationError({"detail": "Bu hujjat asosida boshqa hujjatlar yaratilgan — avval ularni o'chiring"})
        try:
            D.unpost_doc(doc)
        except DjangoValidationError as e:
            raise _err(e)
        doc.delete()

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        doc = self.get_object()
        try:
            if doc.type in D.STOCK_TYPES:
                D.post_doc(doc)
            else:
                doc.posted = True
                doc.save(update_fields=["posted"])
        except DjangoValidationError as e:
            raise _err(e)
        return Response(StockDocSerializer(StockDoc.objects.get(pk=doc.pk)).data)

    @action(detail=True, methods=["post"])
    def unpost(self, request, pk=None):
        doc = self.get_object()
        try:
            if doc.type in D.STOCK_TYPES:
                D.unpost_doc(doc)
            else:
                doc.posted = False
                doc.save(update_fields=["posted"])
        except DjangoValidationError as e:
            raise _err(e)
        return Response(StockDocSerializer(StockDoc.objects.get(pk=doc.pk)).data)

    @action(detail=True, methods=["post"])
    def derive(self, request, pk=None):
        """Asos hujjatdan yangi hujjat (qoralama): buyurtma → qabul qilish; qabul qilish → qaytarish."""
        src = self.get_object()
        target = request.data.get("type")
        allowed = {T.PURCHASE_ORDER: [T.SUPPLY], T.SUPPLY: [T.PURCHASE_RETURN]}
        if target not in allowed.get(src.type, []):
            raise ValidationError({"detail": "Bu hujjatdan bunday hujjat yaratib bo'lmaydi"})
        if not request.user.can(_module_for(target), "create"):
            raise PermissionDenied("Huquq yo'q")
        with transaction.atomic():
            doc = StockDoc.objects.create(type=target, warehouse=src.warehouse, counterparty=src.counterparty,
                                          currency=src.currency, source=src, posted=False, branch=src.branch,
                                          created_by=request.user, note=f"{src.get_type_display()} №{src.number} asosida")
            # buyurtmadan: hali qabul qilinmagan qoldiq miqdor
            received = defaultdict(Decimal)
            if target == T.SUPPLY:
                for it in StockDocItem.objects.filter(doc__source=src, doc__type=T.SUPPLY).exclude(doc=doc):
                    received[it.material_id] += it.qty
            for pos, it in enumerate(src.items.all()):
                q = it.qty - received.get(it.material_id, Decimal("0"))
                if q > 0:
                    StockDocItem.objects.create(doc=doc, material=it.material, qty=q, price=it.price,
                                                discount_pct=it.discount_pct, position=pos)
        return Response(StockDocSerializer(doc).data, status=201)

    @action(detail=False, methods=["post"])
    def from_sale(self, request):
        """Sotuvdan mijoz qaytarishi (qoralama): sotuvdagi tovar pozitsiyalari."""
        from apps.sales.models import Sale

        if not request.user.can("sales", "create"):
            raise PermissionDenied("Huquq yo'q")
        sale = Sale.objects.filter(pk=request.data.get("sale"), status=Sale.Status.COMPLETED).first()
        if not sale:
            raise ValidationError({"detail": "Faqat yakunlangan sotuvdan qaytarish qilinadi"})
        with transaction.atomic():
            doc = StockDoc.objects.create(type=T.SALES_RETURN, warehouse=sale.warehouse, counterparty=sale.client,
                                          currency=sale.currency, sale=sale, posted=False, branch=sale.branch,
                                          created_by=request.user, note=f"Sotuv №{sale.number} bo'yicha qaytarish")
            for pos, it in enumerate(sale.items.filter(product__isnull=False)):
                StockDocItem.objects.create(doc=doc, material=it.product, qty=it.qty, price=it.price,
                                            discount_pct=it.discount_pct, position=pos)
        return Response(StockDocSerializer(doc).data, status=201)


from rest_framework.decorators import api_view, permission_classes  # noqa: E402


@api_view(["GET"])
@permission_classes([module_perm("warehouse")])
def turnover(request):
    from .turnover import turnover_rows
    return Response(turnover_rows(request.query_params))


@api_view(["GET"])
@permission_classes([module_perm("warehouse")])
def turnover_moves(request):
    from .turnover import material_moves
    if not request.query_params.get("material"):
        raise ValidationError({"material": "Tovarni tanlang"})
    return Response(material_moves(request.query_params))

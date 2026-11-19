from decimal import Decimal
from datetime import date

from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.models import Role, User
from apps.core.models import Branch
from apps.core.tenancy import current_branch_id
from apps.accounts.permissions import module_perm

from .models import (
    Employee,
    KpiResult,
    KpiScale,
    KpiTemplate,
    PayrollAdjustment,
    PieceworkEntry,
    Timesheet,
)
from .services import payroll


class EmployeeSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    pay_system_display = serializers.CharField(source="get_pay_system_display", read_only=True)
    access = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ["id", "full_name", "user", "access", "department", "department_name", "branch", "branch_name", "position", "phone",
                  "hired_at", "note", "pay_system", "pay_system_display", "base_salary", "kpi_bonus_base", "is_active"]
        read_only_fields = ["user"]

    def get_access(self, obj):
        u = obj.user
        if not u:
            return None
        return {"username": u.username, "role": u.role_id, "role_name": u.role.name if u.role_id else None,
                "is_active": u.is_active, "last_login": u.last_login, "is_owner": u.is_owner,
                "branches": [b.id for b in u.branches.all()]}

    def to_representation(self, obj):
        data = super().to_representation(obj)
        req = self.context.get("request")
        # Maosh ma'lumotlari faqat "KPI va oylik" huquqi borlarga ko'rinadi
        if req and not req.user.can_view("hr"):
            for k in ("base_salary", "kpi_bonus_base"):
                data[k] = None
        return data


class AccessSerializer(serializers.Serializer):
    username = serializers.RegexField(r"^[\w.@+-]+$", max_length=150)
    password = serializers.CharField(required=False, allow_blank=True)
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects)
    is_active = serializers.BooleanField(default=True)
    branches = serializers.PrimaryKeyRelatedField(many=True, queryset=Branch.objects, required=False)


class TimesheetSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = Timesheet
        fields = ["id", "employee", "employee_name", "month", "days_worked", "working_days"]
        extra_kwargs = {"working_days": {"required": False}}

    def create(self, validated):
        from apps.core.models import SystemSettings

        validated.setdefault("working_days", SystemSettings.load().working_days)
        return super().create(validated)


class PieceworkSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    order_number = serializers.IntegerField(source="task.order.number", read_only=True)
    operation_name = serializers.CharField(source="task.operation.name", read_only=True)

    class Meta:
        model = PieceworkEntry
        fields = ["id", "employee", "employee_name", "task", "order_number", "operation_name", "date", "qty", "rate", "amount"]
        read_only_fields = ["amount"]
        extra_kwargs = {"rate": {"required": False}}


class AdjustmentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = PayrollAdjustment
        fields = ["id", "employee", "employee_name", "month", "kind", "kind_display", "amount", "note"]


class KpiScaleSerializer(serializers.ModelSerializer):
    class Meta:
        model = KpiScale
        fields = ["id", "template", "min_pct", "coefficient"]


class KpiTemplateSerializer(serializers.ModelSerializer):
    scale = KpiScaleSerializer(many=True, read_only=True)
    direction_display = serializers.CharField(source="get_direction_display", read_only=True)

    class Meta:
        model = KpiTemplate
        fields = ["id", "name", "unit", "direction", "direction_display", "cap_pct", "scale"]


class KpiResultSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)
    unit = serializers.CharField(source="template.unit", read_only=True)
    subject = serializers.SerializerMethodField()
    achievement_pct = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)
    coefficient = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)

    class Meta:
        model = KpiResult
        fields = ["id", "template", "template_name", "unit", "month", "employee", "department", "subject",
                  "plan", "fact", "achievement_pct", "coefficient"]

    def get_subject(self, obj):
        return obj.employee.full_name if obj.employee_id else (obj.department.name if obj.department_id else "—")

    def validate(self, attrs):
        if not attrs.get("employee") and not attrs.get("department"):
            raise serializers.ValidationError("Xodim yoki bo'limni tanlang")
        return attrs


class EmployeeViewSet(viewsets.ModelViewSet):
    module = ("company", "hr")
    def get_queryset(self):
        qs = Employee.objects.select_related("department", "branch", "user__role").prefetch_related("user__branches")
        bid = current_branch_id()
        return qs.filter(Q(branch_id=bid) | Q(branch__isnull=True)) if bid else qs

    serializer_class = EmployeeSerializer
    filterset_fields = ["department", "pay_system", "is_active"]
    search_fields = ["full_name", "phone", "position"]

    def _check_salary_edit(self, serializer):
        if not self.request.user.can_edit("hr"):
            for k in ("base_salary", "kpi_bonus_base", "pay_system"):
                serializer.validated_data.pop(k, None)

    def perform_create(self, serializer):
        self._check_salary_edit(serializer)
        serializer.save()

    def perform_update(self, serializer):
        self._check_salary_edit(serializer)
        emp = serializer.save()
        if emp.user_id and emp.user.department_id != emp.department_id:
            emp.user.department_id = emp.department_id
            emp.user.save(update_fields=["department"])

    def perform_destroy(self, instance):
        from django.db.models import ProtectedError

        try:
            instance.delete()
        except ProtectedError:
            raise serializers.ValidationError("Xodimda ishbay yozuvlari bor — o'chirib bo'lmaydi, nofaol qiling")

    @action(detail=True, methods=["post", "delete"], permission_classes=[module_perm("settings")])
    def access(self, request, pk=None):
        """Tizimga kirish: login, parol, rol berish (Sozlamalar huquqi kerak). DELETE — bloklash."""
        emp = self.get_object()
        if request.method == "DELETE":
            if emp.user_id:
                if emp.user == request.user:
                    raise serializers.ValidationError("O'zingizni bloklay olmaysiz")
                emp.user.is_active = False
                emp.user.save(update_fields=["is_active"])
            return Response(self.get_serializer(emp).data)
        s = AccessSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with transaction.atomic():
            user = emp.user
            if User.objects.filter(username=d["username"]).exclude(pk=user.pk if user else None).exists():
                raise serializers.ValidationError({"username": "Bu login band"})
            if user is None:
                if not d.get("password"):
                    raise serializers.ValidationError({"password": "Yangi foydalanuvchi uchun parol kiriting"})
                company = request.user.company
                if company.max_users and company.users.filter(is_active=True).count() >= company.max_users:
                    raise serializers.ValidationError(f"Tarif bo'yicha foydalanuvchilar soni chegarasi: {company.max_users}")
                user = User(username=d["username"], company=company)
            if user.is_owner and (d["role"] != user.role or not d["is_active"]):
                raise serializers.ValidationError("Kompaniya egasining roli va holatini o'zgartirib bo'lmaydi")
            if user == request.user and not d["is_active"]:
                raise serializers.ValidationError("O'zingizni bloklay olmaysiz")
            user.username = d["username"]
            user.role = d["role"]
            user.is_active = d["is_active"]
            user.department_id = emp.department_id
            parts = emp.full_name.split(" ", 1)
            user.first_name, user.last_name = parts[0], (parts[1] if len(parts) > 1 else "")
            user.phone = emp.phone
            if d.get("password"):
                validate_password(d["password"], user)
                user.set_password(d["password"])
            user.save()
            if "branches" in d:
                user.branches.set(d["branches"])
            if emp.user_id != user.id:
                emp.user = user
                emp.save(update_fields=["user"])
        return Response(self.get_serializer(emp).data)


class TimesheetViewSet(viewsets.ModelViewSet):
    module = "hr"
    def get_queryset(self):
        return Timesheet.objects.select_related("employee")

    serializer_class = TimesheetSerializer
    filterset_fields = ["employee", "month"]


class PieceworkViewSet(viewsets.ModelViewSet):
    module = "hr"
    def get_queryset(self):
        return PieceworkEntry.objects.select_related("employee", "task__order", "task__operation")

    serializer_class = PieceworkSerializer
    filterset_fields = ["employee", "task", "task__order"]


class AdjustmentViewSet(viewsets.ModelViewSet):
    module = "hr"
    def get_queryset(self):
        return PayrollAdjustment.objects.select_related("employee")

    serializer_class = AdjustmentSerializer
    filterset_fields = ["employee", "month", "kind"]


def ensure_kpi_defaults():
    """Yangi kompaniyada KPI bo'sh bo'lmasin: standart shablonlar va umumiy koeffitsiyent shkalasi."""
    if not KpiTemplate.objects.exists():
        for name, unit, direction, cap in [("Sotuv rejasi", "mln so'm", "higher", 150),
                                           ("Muddatida topshirish", "%", "higher", 100),
                                           ("Brak (nuqson)", "%", "lower", 150)]:
            KpiTemplate.objects.create(name=name, unit=unit, direction=direction, cap_pct=cap)
    if not KpiScale.objects.filter(template__isnull=True).exists():
        for mn, k in [(110, "1.2"), (100, "1.0"), (90, "0.8"), (0, "0")]:
            KpiScale.objects.create(min_pct=mn, coefficient=Decimal(k))


class KpiTemplateViewSet(viewsets.ModelViewSet):
    module = "hr"

    def get_queryset(self):
        ensure_kpi_defaults()
        return KpiTemplate.objects.prefetch_related("scale")

    def perform_destroy(self, instance):
        if instance.results.exists():
            raise serializers.ValidationError({"detail": "Shablon bo'yicha natijalar bor — avval ularni o'chiring"})
        instance.delete()

    serializer_class = KpiTemplateSerializer


class KpiScaleViewSet(viewsets.ModelViewSet):
    module = "hr"

    def get_queryset(self):
        ensure_kpi_defaults()
        return KpiScale.objects.all()

    serializer_class = KpiScaleSerializer
    filterset_fields = ["template"]


class KpiResultViewSet(viewsets.ModelViewSet):
    module = "hr"
    def get_queryset(self):
        return KpiResult.objects.select_related("template", "employee", "department").prefetch_related("template__scale")

    serializer_class = KpiResultSerializer
    filterset_fields = ["month", "employee", "department", "template"]


@api_view(["GET"])
@permission_classes([module_perm("hr")])
def payroll_view(request):
    m = request.query_params.get("month")
    month = date.fromisoformat(m) if m else timezone.localdate().replace(day=1)
    return Response(payroll(month))

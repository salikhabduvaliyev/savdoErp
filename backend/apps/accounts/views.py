from django.contrib.auth.password_validation import validate_password
from django.db.models import Count
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from apps.core.models import Branch
from apps.core.tenancy import set_context

from .models import ACTIONS, MODULE_GROUPS, SCOPED_MODULES, Role, User, normalize_permissions
from .permissions import SubscriptionExpired, TenantUser, activate_tenant
from .services import register_company


class RoleSerializer(serializers.ModelSerializer):
    users_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Role
        fields = ["id", "code", "name", "description", "permissions", "own_department_only", "is_system", "users_count"]
        read_only_fields = ["is_system"]

    def validate_permissions(self, value):
        return normalize_permissions(value)

    def validate(self, attrs):
        if self.instance and self.instance.is_system and self.instance.code in ("admin", "director"):
            perms = attrs.get("permissions")
            if perms and not (perms["settings"]["view"] and perms["settings"]["edit"]):
                raise serializers.ValidationError("Administrator/Direktor rolidan sozlamalar huquqini olib bo'lmaydi")
        return attrs


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True, default=None)
    role_code = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    employee = serializers.SerializerMethodField()
    branches = serializers.PrimaryKeyRelatedField(many=True, queryset=Branch.objects, required=False)
    branch_names = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name", "full_name", "role", "role_name", "role_code",
            "department", "department_name", "phone", "email", "is_active", "is_owner", "last_login",
            "employee", "branches", "branch_names",
        ]
        read_only_fields = ["is_owner", "last_login", "username"]

    def get_employee(self, obj):
        emp = getattr(obj, "employee", None)
        return {"id": emp.id, "full_name": emp.full_name, "position": emp.position} if emp else None

    def get_branch_names(self, obj):
        return [b.name for b in obj.branches.all()]


class MeSerializer(UserSerializer):
    permissions = serializers.DictField(source="permissions_map", read_only=True)
    own_department_only = serializers.BooleanField(read_only=True)
    is_platform_admin = serializers.BooleanField(read_only=True)
    company = serializers.SerializerMethodField()
    available_branches = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["permissions", "own_department_only", "is_platform_admin", "company",
                                               "available_branches", "preferences"]

    def get_company(self, obj):
        c = obj.company
        if not c:
            return None
        req = self.context.get("request")
        return {
            "id": c.id, "name": c.name, "status": c.status, "status_display": c.get_status_display(),
            "access_until": c.access_until, "days_left": c.days_left, "is_accessible": c.is_accessible,
            "logo": req.build_absolute_uri(c.logo.url) if (c.logo and req) else None,
        }

    def get_available_branches(self, obj):
        if not obj.company_id:
            return []
        qs = Branch.all_objects.filter(company_id=obj.company_id, is_active=True)
        allowed = obj.allowed_branch_ids()
        if allowed is not None:
            qs = qs.filter(id__in=allowed)
        return [{"id": b.id, "name": b.name, "is_main": b.is_main} for b in qs.order_by("-is_main", "name")]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    # Obuna tugagan bo'lsa ham "me" ishlaydi — frontend bloklash ekranini ko'rsatadi
    try:
        activate_tenant(request)
    except SubscriptionExpired:
        set_context(request.user.company_id, None)
    return Response(MeSerializer(request.user, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([TenantUser])
def modules(request):
    return Response({
        "groups": [{"title": t, "modules": [{"key": k, "label": l} for k, l in items]} for t, items in MODULE_GROUPS],
        "actions": ACTIONS,
        "scoped": SCOPED_MODULES,
    })


@api_view(["GET"])
@permission_classes([TenantUser])
def user_lookup(request):
    """Tanlash ro'yxatlari uchun (menejer, operator) — huquqdan qat'i nazar qisqa ma'lumot."""
    qs = User.objects.filter(company_id=request.user.company_id, is_active=True).select_related("role", "employee")
    role = request.query_params.get("role")
    if role:
        qs = qs.filter(role__code__in=role.split(","))
    return Response([{"id": u.id, "full_name": u.full_name, "role": u.role_code} for u in qs])


class RegisterSerializer(serializers.Serializer):
    company_name = serializers.CharField(max_length=200)
    full_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=32)
    email = serializers.EmailField(required=False, allow_blank=True)
    username = serializers.RegexField(r"^[\w.@+-]{3,150}$")
    password = serializers.CharField(min_length=8)

    def validate_username(self, v):
        if User.objects.filter(username__iexact=v).exists():
            raise serializers.ValidationError("Bu login band")
        return v

    def validate(self, attrs):
        validate_password(attrs["password"], User(username=attrs["username"]))
        return attrs


class RegisterThrottle(AnonRateThrottle):
    rate = "10/hour"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([RegisterThrottle])
def register(request):
    """Yangi kompaniya ro'yxatdan o'tishi: 14 kunlik sinov muddati."""
    s = RegisterSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    company, owner = register_company(**s.validated_data)
    return Response({"company": company.name, "username": owner.username, "trial_ends": company.trial_ends}, status=201)


class RoleViewSet(viewsets.ModelViewSet):
    serializer_class = RoleSerializer
    module = "settings"

    def get_queryset(self):
        return Role.objects.annotate(users_count=Count("users"))

    def perform_destroy(self, instance):
        if instance.code == "admin":
            raise serializers.ValidationError("Administrator rolini o'chirib bo'lmaydi")
        if instance.users.exists():
            raise serializers.ValidationError("Bu rolda foydalanuvchilar bor — avval ularni boshqa rolga o'tkazing")
        instance.delete()


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    module = "settings"
    filterset_fields = ["role", "department", "is_active"]
    search_fields = ["username", "first_name", "last_name", "employee__full_name"]
    http_method_names = ["get", "patch", "post", "delete", "head", "options"]

    def get_queryset(self):
        return (User.objects.filter(company_id=self.request.user.company_id)
                .select_related("department", "role", "employee").prefetch_related("branches").order_by("username"))

    def create(self, request, *args, **kwargs):
        raise serializers.ValidationError("Foydalanuvchi xodim orqali yaratiladi (Kompaniya → Xodimlar yoki '+ Foydalanuvchi')")

    def perform_update(self, serializer):
        user = serializer.instance
        data = serializer.validated_data
        if user == self.request.user and data.get("is_active") is False:
            raise serializers.ValidationError("O'zingizni bloklay olmaysiz")
        if user.is_owner and ("role" in data or data.get("is_active") is False):
            raise serializers.ValidationError("Kompaniya egasining roli va holatini o'zgartirib bo'lmaydi")
        serializer.save()

    def perform_destroy(self, instance):
        # Foydalanuvchi o'chirilmaydi (tarix saqlanadi) — faqat bloklanadi
        if instance == self.request.user or instance.is_owner:
            raise serializers.ValidationError("Bu foydalanuvchini bloklab bo'lmaydi")
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @action(detail=True, methods=["post"])
    def set_password(self, request, pk=None):
        user = self.get_object()
        pw = request.data.get("password", "")
        validate_password(pw, user)
        user.set_password(pw)
        user.save()
        return Response({"ok": True})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def my_preferences(request):
    """Foydalanuvchi sozlamalari: mavzu, til, jadval ustunlari (birlashtirib saqlanadi)."""
    user = request.user
    if request.method == "PATCH":
        if not isinstance(request.data, dict):
            raise serializers.ValidationError("Noto'g'ri format")
        prefs = dict(user.preferences or {})
        for k, v in request.data.items():
            if v is None:
                prefs.pop(k, None)
            else:
                prefs[k] = v
        user.preferences = prefs
        user.save(update_fields=["preferences"])
    return Response(user.preferences or {})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_own_password(request):
    user = request.user
    if not user.check_password(request.data.get("old_password", "")):
        raise serializers.ValidationError({"old_password": "Joriy parol noto'g'ri"})
    pw = request.data.get("new_password", "")
    validate_password(pw, user)
    user.set_password(pw)
    user.save()
    return Response({"ok": True})

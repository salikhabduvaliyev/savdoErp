"""Platforma admini: kompaniyalar, obuna muddatlari, bloklash, kompaniya foydalanuvchilari."""
import secrets
import string
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import Company

from .permissions import IsPlatformAdmin


class PlatformCompanySerializer(serializers.ModelSerializer):
    users_count = serializers.IntegerField(read_only=True)
    branches_count = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    access_until = serializers.DateField(read_only=True)
    days_left = serializers.IntegerField(read_only=True)
    is_accessible = serializers.BooleanField(read_only=True)

    class Meta:
        model = Company
        fields = ["id", "name", "legal_name", "inn", "phone", "email", "director", "status", "status_display",
                  "trial_ends", "paid_until", "access_until", "days_left", "is_accessible", "max_users",
                  "platform_note", "created_at", "users_count", "branches_count", "owner"]
        read_only_fields = ["name", "legal_name", "inn", "phone", "email", "director", "created_at"]

    def get_branches_count(self, obj):
        from apps.core.models import Branch

        return Branch.all_objects.filter(company=obj).count()

    def get_owner(self, obj):
        u = obj.users.filter(is_owner=True).first()
        return {"username": u.username, "full_name": u.full_name, "phone": u.phone, "last_login": u.last_login} if u else None


class PlatformCompanyViewSet(viewsets.ModelViewSet):
    serializer_class = PlatformCompanySerializer
    permission_classes = [IsPlatformAdmin]
    http_method_names = ["get", "patch", "post", "head", "options"]
    search_fields = ["name", "phone", "inn"]
    filterset_fields = ["status"]

    def get_queryset(self):
        return Company.objects.annotate(users_count=Count("users", distinct=True))

    def create(self, request, *args, **kwargs):
        raise serializers.ValidationError("Kompaniya ro'yxatdan o'tish sahifasi orqali yaratiladi")

    @action(detail=True, methods=["post"])
    def extend(self, request, pk=None):
        """Obunani uzaytirish: {days: 30} yoki {until: 'YYYY-MM-DD'} → status=active."""
        c = self.get_object()
        today = timezone.localdate()
        if request.data.get("until"):
            c.paid_until = serializers.DateField().to_internal_value(request.data["until"])
        else:
            days = int(request.data.get("days", 30))
            base = max(c.paid_until or today, today)
            c.paid_until = base + timedelta(days=days)
        c.status = Company.Status.ACTIVE
        c.save()
        c.users_count = c.users.count()
        return Response(self.get_serializer(c).data)

    @action(detail=True, methods=["get"])
    def users(self, request, pk=None):
        """Kompaniya foydalanuvchilari: login, joriy parol (shifrdan ochiladi), ism, rol, holat, oxirgi kirish."""
        from apps.core import audit

        from .models import User
        from .vault import unseal

        c = self.get_object()
        rows = []
        for u in User.objects.filter(company=c).select_related("role", "employee").order_by("-is_owner", "username"):
            rows.append({"id": u.id, "username": u.username, "full_name": u.full_name, "phone": u.phone,
                         "role": "Egasi (barcha huquqlar)" if u.is_owner else (u.role.name if u.role_id else None),
                         "is_owner": u.is_owner, "is_active": u.is_active, "last_login": u.last_login,
                         "date_joined": u.date_joined, "password": unseal(u.password_vault)})
        try:
            audit.log("passwords_viewed", c, {"Platforma admini": [None, request.user.username]})
        except Exception:  # noqa: BLE001 — audit ixtiyoriy
            pass
        return Response(rows)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        """Parolni tiklash: {user, password?} — berilmasa tasodifiy 10 belgili parol. Yangi parol bir marta qaytariladi."""
        from django.contrib.auth.password_validation import validate_password

        from apps.core import audit

        from .models import User

        c = self.get_object()
        u = User.objects.filter(company=c, pk=request.data.get("user")).first()
        if not u:
            raise serializers.ValidationError({"user": "Foydalanuvchi topilmadi"})
        pw = (request.data.get("password") or "").strip()
        if pw:
            validate_password(pw, u)
        else:
            alphabet = string.ascii_letters + string.digits
            pw = "".join(secrets.choice(alphabet) for _ in range(10))
        u.set_password(pw)
        u.save(update_fields=["password"])
        try:
            audit.log("password_reset", u, {"Platforma admini": [None, request.user.username]})
        except Exception:  # noqa: BLE001 — audit ixtiyoriy
            pass
        return Response({"username": u.username, "password": pw})

"""Modul bo'yicha huquqlar + kompaniya konteksti + obuna tekshiruvi.

Rol har bir modulga: view / create / edit / delete (+ scope: all | own).

ViewSet'da:   module = "orders"            (yoki bir nechta: ("company", "hr") — istalgani yetarli)
              public_read = True           (ma'lumotnoma: o'qish kompaniyaning hamma xodimiga ochiq)
              action_perms = {"set_status": "edit"}  (maxsus amallar; standart — POST/PUT/PATCH → edit)
api_view'da:  @permission_classes([module_perm("finance")])
"""
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.tenancy import set_context

BRANCH_HEADER = "HTTP_X_BRANCH"


class SubscriptionExpired(APIException):
    status_code = 402
    default_detail = "Obuna muddati tugagan yoki kompaniya bloklangan. Administrator bilan bog'laning."
    default_code = "subscription_expired"


def _modules(value):
    if not value:
        return ()
    return (value,) if isinstance(value, str) else tuple(value)


def activate_tenant(request):
    """Foydalanuvchi kompaniyasi va tanlangan filialni kontekstga o'rnatadi."""
    user = request.user
    if not user or not user.is_authenticated or not user.company_id:
        set_context(None, None)
        return
    if not user.company.is_accessible:
        raise SubscriptionExpired()
    branch_id = None
    raw = request.META.get(BRANCH_HEADER)
    if raw and raw.isdigit():
        branch_id = int(raw)
        allowed = user.allowed_branch_ids()
        if allowed is not None and branch_id not in allowed:
            raise PermissionDenied("Bu filialga ruxsatingiz yo'q")
        from apps.core.models import Branch

        if not Branch.all_objects.filter(pk=branch_id, company_id=user.company_id).exists():
            branch_id = None
    else:
        allowed = user.allowed_branch_ids()
        if allowed and len(allowed) == 1:
            branch_id = allowed[0]
    set_context(user.company_id, branch_id)
    request.branch_id = branch_id


def required_action(request, view):
    if request.method in SAFE_METHODS:
        return "view"
    action = getattr(view, "action", None)
    custom = getattr(view, "action_perms", {}) or {}
    if action in custom:
        return custom[action]
    if action == "create":
        return "create"
    if action == "destroy" or request.method == "DELETE":
        return "delete"
    return "edit"


class ModulePermission(BasePermission):
    message = "Bu amal uchun huquqingiz yo'q"

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        activate_tenant(request)
        modules = _modules(getattr(view, "module", None))
        if not modules:
            return True
        if not user.company_id:  # platforma admini biznes ma'lumotlariga kirmaydi
            return False
        act = required_action(request, view)
        if act == "view" and getattr(view, "public_read", False):
            return True
        return any(user.can(m, act) for m in modules)


def module_perm(module, public_read=False, action=None):
    class _Perm(ModulePermission):
        def has_permission(self, request, view):
            view.module = module
            view.public_read = public_read
            if action:
                view.action_perms = {getattr(view, "action", None): action}
            return super().has_permission(request, view)

    _Perm.__name__ = f"ModulePermission_{module}"
    return _Perm


class IsPlatformAdmin(BasePermission):
    def has_permission(self, request, view):
        set_context(None, None)
        return bool(request.user and request.user.is_authenticated and request.user.is_platform_admin)


class TenantUser(BasePermission):
    """Kompaniya xodimi (modulsiz endpointlar uchun: me, lookup)."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        activate_tenant(request)
        return True

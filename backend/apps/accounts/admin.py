from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Role, User


@admin.register(User)
class ERPUserAdmin(UserAdmin):
    list_display = ("username", "first_name", "last_name", "company", "role", "is_owner", "is_active")
    list_filter = ("company", "is_owner", "is_active")
    fieldsets = UserAdmin.fieldsets + (("ERP", {"fields": ("company", "role", "is_owner", "branches", "department", "phone")}),)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "company", "own_department_only", "is_system")
    list_filter = ("company",)

from django.contrib import admin

from .models import Estimate, EstimateMaterial, EstimateService, Order


class MaterialInline(admin.TabularInline):
    model = EstimateMaterial
    extra = 0


class ServiceInline(admin.TabularInline):
    model = EstimateService
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["number", "date", "client", "amount", "currency", "status", "plan_date", "production_date"]
    list_filter = ["status", "currency"]
    search_fields = ["number", "client__name"]


@admin.register(Estimate)
class EstimateAdmin(admin.ModelAdmin):
    list_display = ["order", "version", "is_active"]
    inlines = [MaterialInline, ServiceInline]

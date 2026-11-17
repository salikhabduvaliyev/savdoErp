from django.contrib import admin

from .models import Branch, Company, ExchangeRate, SystemSettings

admin.site.site_header = "Akfa ERP — platforma"


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ["name", "status", "trial_ends", "paid_until", "phone", "created_at"]
    list_filter = ["status"]
    search_fields = ["name", "phone", "inn"]


admin.site.register(Branch, list_display=["name", "company", "is_main", "is_active"], list_filter=["company"])
admin.site.register(ExchangeRate, list_display=["date", "usd_uzs", "company"], list_filter=["company"])
admin.site.register(SystemSettings, list_display=["company"])

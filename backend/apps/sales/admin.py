from django.contrib import admin

from .models import Sale, SaleItem


class ItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    exclude = ["company"]


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["number", "date", "company", "client", "currency", "status"]
    list_filter = ["company", "status"]
    inlines = [ItemInline]

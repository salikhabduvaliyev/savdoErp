from django.contrib import admin

from .models import Material, MaterialGroup, PriceType, ProductPrice, Reservation, Stock, StockMove, Warehouse

admin.site.register(Warehouse, list_display=["name", "company", "branch"], list_filter=["company"])
admin.site.register(MaterialGroup, list_display=["name", "company"])
admin.site.register(PriceType, list_display=["name", "currency", "is_default", "company"])
admin.site.register(ProductPrice, list_display=["product", "price_type", "price"])
admin.site.register(Material, list_display=["name", "type", "unit", "currency", "min_qty", "company"],
                    search_fields=["name"], list_filter=["company", "type"])
admin.site.register(Stock, list_display=["material", "warehouse", "qty", "reserved", "avg_cost"])
admin.site.register(Reservation, list_display=["order", "material", "warehouse", "qty"])
admin.site.register(StockMove, list_display=["date", "type", "material", "warehouse", "qty", "price", "order"], list_filter=["type"])

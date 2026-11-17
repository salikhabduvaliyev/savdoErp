from django.contrib import admin

from .models import Department, Operation, ProductionTask, PurchaseRequest

admin.site.register(Department, list_display=["name", "sequence", "daily_capacity"])
admin.site.register(Operation, list_display=["name", "department", "unit", "default_rate", "rate_currency", "piece_rate"])
admin.site.register(ProductionTask, list_display=["order", "operation", "status", "plan_qty", "done_qty", "deadline"], list_filter=["status", "department"])
admin.site.register(PurchaseRequest, list_display=["material", "qty", "order", "status"])

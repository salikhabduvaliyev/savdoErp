from django.contrib import admin

from .models import Employee, KpiResult, KpiScale, KpiTemplate, PayrollAdjustment, PieceworkEntry, Timesheet

admin.site.register(Employee, list_display=["full_name", "department", "pay_system", "base_salary", "is_active"])
admin.site.register(Timesheet, list_display=["employee", "month", "days_worked", "working_days"])
admin.site.register(PieceworkEntry, list_display=["employee", "task", "date", "qty", "rate", "amount"])
admin.site.register(PayrollAdjustment, list_display=["employee", "month", "kind", "amount"])
admin.site.register(KpiTemplate, list_display=["name", "direction", "cap_pct"])
admin.site.register(KpiScale, list_display=["template", "min_pct", "coefficient"])
admin.site.register(KpiResult, list_display=["template", "month", "employee", "department", "plan", "fact"])

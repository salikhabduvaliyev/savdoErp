from django.contrib import admin

from .models import Account, ExpenseCategory, Transaction

admin.site.register(Account, list_display=["name", "kind", "currency", "opening_balance", "is_active"])
admin.site.register(ExpenseCategory, list_display=["name", "affects_profit"])
admin.site.register(Transaction, list_display=["date", "kind", "account", "amount", "currency", "order", "description"], list_filter=["kind", "currency"])

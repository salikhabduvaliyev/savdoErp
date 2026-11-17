from django.contrib import admin

from .models import Counterparty

admin.site.register(Counterparty, search_fields=["name", "phone"],
                    list_display=["name", "company", "kind", "is_client", "is_supplier", "phone", "is_active"],
                    list_filter=["company", "is_client", "is_supplier"])

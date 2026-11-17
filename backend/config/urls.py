from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/core/", include("apps.core.urls")),
    path("api/crm/", include("apps.crm.urls")),
    path("api/orders/", include("apps.orders.urls")),
    path("api/sales/", include("apps.sales.urls")),
    path("api/production/", include("apps.production.urls")),
    path("api/warehouse/", include("apps.warehouse.urls")),
    path("api/finance/", include("apps.finance.urls")),
    path("api/hr/", include("apps.hr.urls")),
    path("api/dashboard/", include("apps.dashboard.urls")),
]

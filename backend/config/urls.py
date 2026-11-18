from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from django.views.static import serve


def spa_index(request, *args, **kwargs):
    """React ilovasi (frontend/dist/index.html) — /api va /admin dan boshqa barcha manzillar uchun."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend build topilmadi: frontend papkasida `npm run build` bajaring")
    return FileResponse(open(index, "rb"), content_type="text/html")


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

# Frontend build mavjud bo'lsa — Django o'zi beradi (production / PythonAnywhere).
# PythonAnywhere'da /assets/ ni Web → Static files orqali berish tezroq (DEPLOY.md).
if settings.FRONTEND_DIST.exists():
    urlpatterns += [
        re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": settings.FRONTEND_DIST / "assets"}),
        re_path(r"^(?P<path>favicon\.svg|vite\.svg|robots\.txt)$", serve, {"document_root": settings.FRONTEND_DIST}),
        re_path(r"^(?!api/|admin/|static/|assets/).*$", spa_index),
    ]

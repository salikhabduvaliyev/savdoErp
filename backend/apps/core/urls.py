from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import BranchViewSet, CurrencyDefViewSet, CustomFieldViewSet, ExchangeRateViewSet, company, meta, public_info, system_settings

router = DefaultRouter()
router.register("rates", ExchangeRateViewSet, basename="rate")
router.register("currencies", CurrencyDefViewSet, basename="currency")
router.register("branches", BranchViewSet, basename="branch")
router.register("custom-fields", CustomFieldViewSet, basename="custom-field")

urlpatterns = [
    path("meta/", meta),
    path("public/", public_info),
    path("company/", company),
    path("settings/", system_settings),
] + router.urls

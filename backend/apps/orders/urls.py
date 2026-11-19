from rest_framework.routers import DefaultRouter

from .views import EstimateMaterialViewSet, EstimateServiceViewSet, EstimateViewSet, OrderStateViewSet, OrderViewSet

router = DefaultRouter()
router.register("estimate-materials", EstimateMaterialViewSet, basename="orders-estimate-materials")
router.register("estimate-services", EstimateServiceViewSet, basename="orders-estimate-services")
router.register("estimates", EstimateViewSet, basename="orders-estimates")
router.register("states", OrderStateViewSet, basename="orders-states")
router.register("", OrderViewSet, basename="order")
urlpatterns = router.urls

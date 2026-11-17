from rest_framework.routers import DefaultRouter

from .views import (
    MaterialGroupViewSet,
    PriceTypeViewSet,
    ProductViewSet,
    StockMoveViewSet,
    StockViewSet,
    WarehouseViewSet,
)

router = DefaultRouter()
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("groups", MaterialGroupViewSet, basename="group")
router.register("price-types", PriceTypeViewSet, basename="price-type")
router.register("products", ProductViewSet, basename="product")
router.register("materials", ProductViewSet, basename="material")  # eski nom (moslik uchun)
router.register("stock", StockViewSet, basename="stock")
router.register("moves", StockMoveViewSet, basename="move")
urlpatterns = router.urls

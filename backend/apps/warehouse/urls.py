from django.urls import path
from rest_framework.routers import DefaultRouter

from .doc_views import StockDocViewSet, turnover, turnover_moves

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
router.register("docs", StockDocViewSet, basename="stock-doc")
urlpatterns = [path("turnover/", turnover), path("turnover/moves/", turnover_moves)] + router.urls

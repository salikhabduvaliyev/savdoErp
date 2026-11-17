from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("accounts", views.AccountViewSet, basename="finance-accounts")
router.register("categories", views.ExpenseCategoryViewSet, basename="finance-categories")
router.register("transactions", views.TransactionViewSet, basename="transaction")

urlpatterns = [
    path("summary/", views.summary),
    path("client-debts/", views.client_debts),
    path("supplier-debts/", views.supplier_debts),
    path("pnl/", views.pnl),
    path("cash-flow/", views.cash_flow),
] + router.urls

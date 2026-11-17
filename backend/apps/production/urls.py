from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("departments", views.DepartmentViewSet, basename="production-departments")
router.register("operations", views.OperationViewSet, basename="production-operations")
router.register("processes", views.TechProcessViewSet, basename="production-processes")
router.register("techcards", views.TechCardViewSet, basename="production-techcards")
router.register("orders", views.ProductionOrderViewSet, basename="production-orders")
router.register("jobs", views.JobViewSet, basename="production-jobs")
router.register("tasks", views.TaskViewSet, basename="production-tasks")
router.register("completions", views.CompletionViewSet, basename="production-completions")
router.register("purchase-requests", views.PurchaseRequestViewSet, basename="production-purchase-requests")

urlpatterns = [
    path("labor/", views.labor),
    path("status/", views.status_board),
] + router.urls

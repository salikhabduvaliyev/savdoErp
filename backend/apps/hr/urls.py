from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("employees", views.EmployeeViewSet, basename="hr-employees")
router.register("timesheets", views.TimesheetViewSet, basename="hr-timesheets")
router.register("piecework", views.PieceworkViewSet, basename="hr-piecework")
router.register("adjustments", views.AdjustmentViewSet, basename="hr-adjustments")
router.register("kpi-templates", views.KpiTemplateViewSet, basename="hr-kpi-templates")
router.register("kpi-scale", views.KpiScaleViewSet, basename="hr-kpi-scale")
router.register("kpi-results", views.KpiResultViewSet, basename="hr-kpi-results")

urlpatterns = [path("payroll/", views.payroll_view)] + router.urls

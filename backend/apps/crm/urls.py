from rest_framework.routers import DefaultRouter

from .views import CounterpartyViewSet, GroupViewSet, NoteViewSet, StatusViewSet

router = DefaultRouter()
router.register("counterparties", CounterpartyViewSet, basename="counterparty")
router.register("groups", GroupViewSet, basename="cp-group")
router.register("statuses", StatusViewSet, basename="cp-status")
router.register("notes", NoteViewSet, basename="cp-note")
urlpatterns = router.urls

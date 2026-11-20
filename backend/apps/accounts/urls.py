from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .platform import PlatformCompanyViewSet
from .views import LoginView, RoleViewSet, UserViewSet, change_own_password, me, modules, my_preferences, register, user_lookup

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")
router.register("platform/companies", PlatformCompanyViewSet, basename="platform-company")

urlpatterns = [
    path("login/", LoginView.as_view()),
    path("refresh/", TokenRefreshView.as_view()),
    path("register/", register),
    path("me/", me),
    path("me/password/", change_own_password),
    path("me/prefs/", my_preferences),
    path("modules/", modules),
    path("users-lookup/", user_lookup),
] + router.urls

from rest_framework import routers
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from core.views import DashboardResumoView
from rest_framework import routers
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from core.views import DashboardResumoView

from .views import (
    AuthMeView,
    OficinaViewSet,
    UsuarioOficinaViewSet,
    EtapaViewSet,
    ConfigFotoViewSet,
    OSViewSet,
    FotoOSViewSet,
    SyncView,
    OficinaDriveStatusView,
    GoogleDriveAuthURLView,
    GoogleDriveOAuth2CallbackView,
    PwaVeiculosEmProducaoView,
)

router = routers.DefaultRouter()
router.register(r'oficinas', OficinaViewSet)
router.register(r'usuarios-oficina', UsuarioOficinaViewSet)
router.register(r'etapas', EtapaViewSet)
router.register(r'config-fotos', ConfigFotoViewSet)
router.register(r'os', OSViewSet)
router.register(r'fotos-os', FotoOSViewSet)

urlpatterns = [
    path('sync/', SyncView.as_view(), name='sync'),
    path("dashboard-resumo/", DashboardResumoView.as_view(), name="dashboard-resumo"),
    path("auth/me/", AuthMeView.as_view(), name="auth-me"),

    # Integração Google Drive
    path("drive/status/", OficinaDriveStatusView.as_view(), name="drive-status"),
    path("drive/auth-url/", GoogleDriveAuthURLView.as_view(), name="drive-auth-url"),
    path("google/oauth2/callback/", GoogleDriveOAuth2CallbackView.as_view(), name="google-oauth2-callback"),
    path("pwa/veiculos-em-producao/", PwaVeiculosEmProducaoView.as_view(), name="pwa-veiculos-em-producao"),

]

urlpatterns += router.urls

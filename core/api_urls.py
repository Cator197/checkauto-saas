from django.urls import path
from django.views.generic import RedirectView
from rest_framework import routers

from core.views import DashboardResumoView

from .views import (
    AuthMeView,
    ConfigFotoViewSet,
    EtapaViewSet,
    FotoOSViewSet,
    GoogleDriveAuthURLView,
    GoogleDriveOAuth2CallbackView,
    OSViewSet,
    OficinaDriveStatusView,
    OficinaViewSet,
    ProximaEtapaAPIView,
    PwaVeiculosEmProducaoView,
    SyncView,
    UsuarioOficinaViewSet,
)

router = routers.DefaultRouter()

# Oficina e usuários
router.register(r"oficinas", OficinaViewSet)
router.register(r"usuarios-oficina", UsuarioOficinaViewSet)

# Produção e fotos
router.register(r"etapas", EtapaViewSet)
router.register(r"config-fotos", ConfigFotoViewSet)
router.register(r"os", OSViewSet)
router.register(r"fotos-os", FotoOSViewSet)

urlpatterns = [
    # Operações gerais
    path("sync/", SyncView.as_view(), name="sync"),
    path("dashboard-resumo/", DashboardResumoView.as_view(), name="dashboard-resumo"),

    # Autenticação
    path("auth/me/", AuthMeView.as_view(), name="auth-me"),

    # Integração Google Drive
    path("drive/status/", OficinaDriveStatusView.as_view(), name="drive-status"),
    path("drive/auth-url/", GoogleDriveAuthURLView.as_view(), name="drive-auth-url"),
    path(
        "drive/oauth2/callback/",
        GoogleDriveOAuth2CallbackView.as_view(),
        name="google-oauth2-callback",
    ),
    path(
        "google/oauth2/callback/",
        RedirectView.as_view(
            url="/api/drive/oauth2/callback/", permanent=True, query_string=True
        ),
        name="google-oauth2-callback-legacy",
    ),

    # PWA e fluxo de etapas
    path(
        "pwa/veiculos-em-producao/",
        PwaVeiculosEmProducaoView.as_view(),
        name="pwa-veiculos-em-producao",
    ),
    path("etapas/proxima/", ProximaEtapaAPIView.as_view(), name="proxima-etapa"),
]

urlpatterns += router.urls

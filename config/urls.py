"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.shortcuts import render
from django.views.generic import TemplateView
from core.authentication import CustomTokenObtainPairView
from core.views import integracao_drive_view

from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

def pwa_home(request):
    return render(request, "pwa/index.html")


def pwa_checkin_completo(request):
    return render(request, "pwa/checkin_completo.html")


def pwa_checkin_fotos(request):
    return render(request, "pwa/checkin_fotos.html")


def pwa_sync(request):
    return render(request, "pwa/sync.html")


def pwa_veiculos_em_producao(request):
    return render(request, "pwa/veiculos_em_producao.html")


def pwa_os_producao(request, os_id):
    return render(request, "pwa/os_producao.html", {"os_id": os_id})



urlpatterns = [
    path('admin/', admin.site.urls),

    # PWA - telas do app do funileiro
    path('pwa/', pwa_home, name='pwa_home'),
    path('pwa/checkin-completo/', pwa_checkin_completo, name='pwa_checkin_completo'),
    path('pwa/checkin-fotos/', pwa_checkin_fotos, name='pwa_checkin_fotos'),
    path('pwa/sync/', pwa_sync, name='pwa_sync'),
    path('pwa/veiculos-em-producao/', pwa_veiculos_em_producao, name='pwa_veiculos_em_producao'),
    path('pwa/os/<int:os_id>/', pwa_os_producao, name='pwa_os_producao'),

    # JWT
    path('api/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Rotas da API
    path('api/', include('core.api_urls')),

    #painel
    path("painel/login/", TemplateView.as_view(template_name="painel/login.html"), name="painel_login"),
    path("painel/", TemplateView.as_view(template_name="painel/dashboard.html"), name="painel_dashboard"),
    path("painel/os/", TemplateView.as_view(template_name="painel/os_lista.html"), name="painel_os_lista"),
    path("painel/os/<int:os_id>/", TemplateView.as_view(template_name="painel/os_detalhe.html"), name="painel_os_detalhe"),
    path("painel/etapas/",TemplateView.as_view(template_name="painel/etapas.html"),name="painel_etapas"),
    path("painel/fotos/",TemplateView.as_view(template_name="painel/config_fotos.html"),name="painel_config_fotos"),
    path("painel/usuarios/",TemplateView.as_view(template_name="painel/usuarios.html"),name="painel_usuarios"),
    path("painel/integracoes/drive/",TemplateView.as_view(template_name="painel/integracao_drive.html"),name="painel_integracao_drive"),
    path("integracao-drive/", integracao_drive_view, name="integracao-drive"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

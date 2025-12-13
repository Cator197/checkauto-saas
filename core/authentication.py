from rest_framework.authentication import SessionAuthentication
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from django.contrib.auth.models import User
from .models import UsuarioOficina


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    SessionAuthentication sem exigir CSRF.
    Necessário para permitir que o painel use fetch() com cookies.
    """
    def enforce_csrf(self, request):
        # Ignora completamente a verificação de CSRF
        return


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Serializer de login JWT que devolve:
    - access / refresh
    - dados do usuário (nome, papel, oficina etc.)
    """

    @classmethod
    def get_token(cls, user: User):
        """
        Opcional: adiciona informações extras dentro do próprio token JWT.
        """
        token = super().get_token(user)

        # Tenta achar um vínculo com oficina
        usuario_oficina = (
            user.usuarios_oficina
            .select_related("oficina")
            .filter(ativo=True)
            .first()
        )

        if usuario_oficina:
            token["papel"] = usuario_oficina.papel
            token["oficina_id"] = usuario_oficina.oficina_id
            token["oficina_nome"] = usuario_oficina.oficina.nome

        token["is_superuser"] = user.is_superuser
        token["username"] = user.username

        return token

    def validate(self, attrs):
        """
        Personaliza o payload de resposta do login:
        {
          "refresh": "...",
          "access": "...",
          "user": { ... }
        }
        """
        data = super().validate(attrs)
        user = self.user

        usuario_oficina = (
            user.usuarios_oficina
            .select_related("oficina")
            .filter(ativo=True)
            .first()
        )

        user_data = {
            "id": user.id,
            "username": user.username,
            "nome": user.get_full_name() or user.username,
            "email": user.email,
            "is_superuser": user.is_superuser,
            "papel": None,
            "oficina_id": None,
            "oficina_nome": None,
        }

        if usuario_oficina:
            user_data.update(
                {
                    "papel": usuario_oficina.papel,
                    "oficina_id": usuario_oficina.oficina_id,
                    "oficina_nome": usuario_oficina.oficina.nome,
                }
            )

        data["user"] = user_data
        return data


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    View de login JWT que usa o serializer customizado acima.
    """
    serializer_class = CustomTokenObtainPairSerializer

from rest_framework.permissions import BasePermission, SAFE_METHODS

from .models import UsuarioOficina
from .utils import get_papel_do_usuario


class IsOficinaUser(BasePermission):
    """Permite acesso apenas a usuários autenticados vinculados a uma oficina."""

    message = "Sem permissão para esta ação."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        return UsuarioOficina.objects.filter(user=user, ativo=True).exists()


class IsOficinaAdmin(BasePermission):
    """Restringe ações administrativas a gestores/administradores da oficina."""

    message = "Sem permissão para esta ação."
    allowed_roles = {"ADMIN", "GERENTE"}

    def has_permission(self, request, view):
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        papel = get_papel_do_usuario(user, getattr(request, "auth", None))
        return (papel or "").upper() in self.allowed_roles


class IsOficinaAdminOrReadOnly(IsOficinaAdmin):
    """Permite leitura a qualquer usuário da oficina; escrita apenas para admins."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return IsOficinaUser().has_permission(request, view)

        return super().has_permission(request, view)


class IsOSPermission(BasePermission):
    """Controla permissões de OS para operadores e administradores."""

    message = "Sem permissão para esta ação."
    operator_allowed_patch_fields = {"observacoes"}

    def _is_operator(self, request):
        papel = get_papel_do_usuario(request.user, getattr(request, "auth", None))
        return (papel or "").upper() == "FUNC"

    def has_permission(self, request, view):
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if getattr(view, "action", None) in {"create", "update", "destroy"}:
            return not self._is_operator(request)

        if getattr(view, "action", None) == "partial_update" and self._is_operator(request):
            data_keys = set(request.data.keys())
            return not data_keys or data_keys.issubset(self.operator_allowed_patch_fields)

        return True

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class IsFotoOSPermission(BasePermission):
    """Impede operadores de remover fotos, mantendo demais ações liberadas."""

    message = "Sem permissão para esta ação."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if getattr(view, "action", None) == "destroy":
            papel = get_papel_do_usuario(user, getattr(request, "auth", None))
            return (papel or "").upper() != "FUNC"

        return True

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)

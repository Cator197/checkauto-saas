from .models import UsuarioOficina


def get_oficina_do_usuario(user):
    """
    Retorna a oficina principal do usuário.
    Para superusuário (is_superuser), retornamos None (sem filtro).
    Para usuário sem vínculo, retornamos None (podemos tratar como sem acesso).
    """
    if not user.is_authenticated:
        return None

    if user.is_superuser:
        return None

    try:
        usuario_oficina = UsuarioOficina.objects.get(user=user, ativo=True)
        return usuario_oficina.oficina
    except UsuarioOficina.DoesNotExist:
        return None

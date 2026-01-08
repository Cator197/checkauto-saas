from .models import UsuarioOficina


def resolve_oficina_atual(user, marcar_se_unica=False):
    if not user or not user.is_authenticated:
        return None, False

    if user.is_superuser:
        return None, False

    vinculos = (
        UsuarioOficina.objects.select_related("oficina")
        .filter(user=user, ativo=True)
        .order_by("id")
    )

    if not vinculos.exists():
        return None, False

    vinculo_atual = vinculos.filter(is_atual=True).first()
    if vinculo_atual:
        return vinculo_atual.oficina, False

    if vinculos.count() == 1:
        unico = vinculos.first()
        if marcar_se_unica and not unico.is_atual:
            unico.is_atual = True
            unico.save(update_fields=["is_atual"])
        return unico.oficina, False

    primeiro = vinculos.first()
    return primeiro.oficina if primeiro else None, True


def get_oficina_do_usuario(user):
    """
    Retorna a oficina principal do usuário.
    Para superusuário (is_superuser), retornamos None (sem filtro).
    Para usuário sem vínculo, retornamos None (podemos tratar como sem acesso).
    """
    oficina, _ = resolve_oficina_atual(user, marcar_se_unica=True)
    return oficina


def get_papel_do_usuario(user, token=None, oficina=None):
    """Retorna o papel do usuário, preferindo o claim do token JWT.

    O token do SimpleJWT exposto em ``request.auth`` funciona como um dicionário
    e pode carregar o claim ``papel``. Se o claim não existir, buscamos o
    vínculo ``UsuarioOficina`` ativo. Quando ``oficina`` é informado, o vínculo
    é filtrado por essa oficina para garantir o papel correto no contexto.
    """

    if token and hasattr(token, "get"):
        papel = token.get("papel")
        if papel:
            return papel

    if not user or not user.is_authenticated:
        return None

    usuario_oficina_qs = user.usuarios_oficina.select_related("oficina").filter(
        ativo=True
    )
    if oficina is not None:
        usuario_oficina_qs = usuario_oficina_qs.filter(oficina=oficina)

    usuario_oficina = usuario_oficina_qs.first()

    if usuario_oficina:
        return usuario_oficina.papel

    return None

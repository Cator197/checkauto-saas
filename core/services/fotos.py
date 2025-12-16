import base64
import logging
from typing import Dict, Optional, Tuple

from django.core.files.base import ContentFile

from core.models import ConfigFoto, FotoOS

logger = logging.getLogger(__name__)


def criar_foto_os(
    *,
    foto: Dict,
    os_obj,
    etapa,
    usuario_oficina=None,
    extra_log: Optional[Dict] = None,
) -> Tuple[Optional[FotoOS], Optional[str]]:
    """
    Cria uma FotoOS a partir de um payload contendo base64/dataUrl.

    Retorna (foto_obj, error_message). Se ocorrer erro na criação, foto_obj será
    None e error_message conterá o motivo (mantendo as mensagens atuais).
    """
    conteudo_base64 = foto.get("arquivo")
    if isinstance(conteudo_base64, dict):
        conteudo_base64 = conteudo_base64.get("dataUrl") or conteudo_base64.get("arquivo")

    if not conteudo_base64:
        conteudo_base64 = foto.get("dataUrl")

    if not conteudo_base64:
        message = "[SYNC] Foto ignorada: sem conteúdo base64."
        logger.warning(message, extra=extra_log)
        return None, message

    header = None
    if conteudo_base64.startswith("data:"):
        header, conteudo_base64 = conteudo_base64.split(",", 1)
    elif "," in conteudo_base64:
        conteudo_base64 = conteudo_base64.split(",", 1)[1]

    try:
        conteudo = base64.b64decode(conteudo_base64)
    except Exception:
        message = "[SYNC] Foto ignorada: base64 inválido."
        logger.warning(message, extra=extra_log)
        return None, message

    extensao = (foto.get("extensao") or "").lower().strip().lstrip(".")
    if not extensao and header:
        if "image/png" in header:
            extensao = "png"
        elif "image/webp" in header:
            extensao = "webp"
        elif "image/jpeg" in header or "image/jpg" in header:
            extensao = "jpg"
    if not extensao:
        extensao = "jpg"

    arquivo = ContentFile(
        conteudo,
        name=f"pwa_os{os_obj.id}_{foto.get('id') or '0'}.{extensao}",
    )

    config_foto_payload = foto.get("config_foto")
    config_foto_id = foto.get("config_foto_id") or None

    if config_foto_id is None and isinstance(config_foto_payload, dict):
        config_foto_id = config_foto_payload.get("id")
    elif config_foto_id is None:
        config_foto_id = config_foto_payload

    tipo = "LIVRE"
    config_foto_obj = None

    if config_foto_id:
        tipo = "PADRAO"
        try:
            config_foto_obj = ConfigFoto.objects.get(id=config_foto_id)
        except ConfigFoto.DoesNotExist:
            config_foto_obj = None

        if not config_foto_obj:
            message = "[SYNC] Foto PADRÃO ignorada: config_foto não encontrada."
            logger.warning(message, extra=extra_log)
            return None, message

    try:
        foto_obj = FotoOS.objects.create(
            os=os_obj,
            etapa=etapa,
            tipo=tipo,
            config_foto=config_foto_obj,
            arquivo=arquivo,
            titulo=foto.get("nome") or None,
            tirada_por=usuario_oficina,
        )
    except Exception as e:
        message = f"[SYNC] Falha ao criar FotoOS: {e}"
        logger.exception(message, extra=extra_log)
        return None, message

    return foto_obj, None

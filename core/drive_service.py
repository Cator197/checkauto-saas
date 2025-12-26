import json
import logging
import os
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2.credentials import Credentials


from core.models import Etapa

from django.conf import settings

from .models import OS, Etapa, FotoOS, OficinaDriveConfig

logger = logging.getLogger(__name__)

from googleapiclient.http import MediaFileUpload
import os


class DriveNaoConfigurado(Exception):
    pass


def _get_oficina_drive_config(oficina) -> OficinaDriveConfig:
    try:
        config = oficina.drive_config
    except OficinaDriveConfig.DoesNotExist:
        raise DriveNaoConfigurado("Oficina não possui integração com Google Drive configurada.")
    if not config.ativo:
        raise DriveNaoConfigurado("Integração com Google Drive está desativada para esta oficina.")
    return config


def _get_credentials(oficina) -> Credentials:
    """
    Constrói o objeto Credentials a partir do JSON salvo no banco.
    """
    config = _get_oficina_drive_config(oficina)
    data = json.loads(config.credentials_json)
    # data deve conter os campos esperados pelo Credentials (token, refresh_token etc.)
    creds = Credentials.from_authorized_user_info(data)
    return creds


def get_drive_service(oficina):
    """
    Retorna o client do Google Drive autenticado para a oficina.
    """
    try:
        creds = _get_credentials(oficina)
        service = build('drive', 'v3', credentials=creds)
        return service
    except Exception:
        logger.exception(
            "Erro ao criar serviço do Drive",
            extra={"oficina_id": getattr(oficina, "id", None)},
        )
        return None


def criar_pasta_os(os_obj: OS) -> Optional[str]:
    """
    Cria (ou garante) a pasta da OS no Google Drive.
    Salva o ID em os_obj.drive_folder_id.
    """
    oficina = os_obj.oficina
    extra_log = {
        "oficina_id": oficina.id,
        "os_id": os_obj.id,
    }
    logger.info(
        "Drive criar_pasta_os iniciado",
        extra={**extra_log, "os_codigo": os_obj.codigo},
    )

    # Se já tiver pasta, não recria
    if os_obj.drive_folder_id:
        logger.info(
            "Drive criar_pasta_os existente",
            extra={**extra_log, "drive_folder_id": os_obj.drive_folder_id},
        )
        return os_obj.drive_folder_id

    # Busca config da oficina
    try:
        config = _get_oficina_drive_config(oficina)
        logger.debug(
            "Drive criar_pasta_os config encontrada",
            extra={**extra_log, "root_folder_id": config.root_folder_id},
        )
    except DriveNaoConfigurado as e:
        logger.warning(
            "Drive criar_pasta_os sem configuracao",
            extra={**extra_log, "erro": str(e)},
        )
        return None
    except Exception:
        logger.exception(
            "Drive criar_pasta_os erro ao obter config",
            extra=extra_log,
        )
        return None

    # Cria serviço do Drive
    service = get_drive_service(oficina)
    if not service:
        logger.warning(
            "Drive criar_pasta_os sem servico",
            extra=extra_log,
        )
        return None

    # Monta os dados da pasta
    nome_pasta = f"OS-{os_obj.codigo} - {os_obj.placa or ''} - {os_obj.modelo_veiculo or ''}".strip()

    # Busca pasta existente para idempotência
    try:
        query = (
            f"mimeType='application/vnd.google-apps.folder' "
            f"and name='{nome_pasta}' "
            f"and '{config.root_folder_id}' in parents "
            f"and trashed=false"
        )
        response = service.files().list(
            q=query,
            fields="files(id, name, createdTime)",
            orderBy="createdTime",
            pageSize=10,
        ).execute()
        encontrados = response.get("files", [])
        if encontrados:
            folder_escolhida = encontrados[0]
            if len(encontrados) > 1:
                logger.warning(
                    "Drive criar_pasta_os encontrou duplicatas",
                    extra={
                        **extra_log,
                        "root_folder_id": config.root_folder_id,
                        "duplicatas": [f.get("id") for f in encontrados],
                    },
                )
            os_obj.drive_folder_id = folder_escolhida.get("id")
            os_obj.save(update_fields=["drive_folder_id"])
            logger.info(
                "Drive criar_pasta_os reutilizada",
                extra={**extra_log, "drive_folder_id": os_obj.drive_folder_id},
            )
            return os_obj.drive_folder_id
    except Exception:
        logger.exception(
            "Drive criar_pasta_os falha ao buscar existente",
            extra={**extra_log, "root_folder_id": config.root_folder_id},
        )

    folder_metadata = {
        "name": nome_pasta,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [config.root_folder_id],
    }
    logger.debug(
        "Drive criar_pasta_os criando",
        extra={**extra_log, "metadata": folder_metadata},
    )

    # Chama API do Drive
    try:
        folder = service.files().create(body=folder_metadata, fields="id").execute()
        folder_id = folder.get("id")
        logger.info(
            "Drive criar_pasta_os criada",
            extra={**extra_log, "drive_folder_id": folder_id},
        )
        os_obj.drive_folder_id = folder_id
        os_obj.save(update_fields=["drive_folder_id"])

        # Cria subpastas das etapas
        try:
            criar_subpastas_etapas(os_obj, service)
            criar_pasta_livres(os_obj, service)
            logger.info("Drive criar_pasta_os subpastas criadas", extra=extra_log)
        except Exception:
            logger.exception(
                "Drive criar_pasta_os erro subpastas",
                extra=extra_log,
            )

        return folder_id


    except Exception:
        logger.exception(
            "Drive criar_pasta_os erro ao criar",
            extra=extra_log,
        )
        return None



def _get_or_create_subpasta_etapa(os_obj: OS, etapa: Etapa) -> Optional[str]:
    """
    Garante uma subpasta com o nome da etapa dentro da pasta da OS.
    Retorna o ID da subpasta.
    """
    oficina = os_obj.oficina
    extra_log = {
        "oficina_id": oficina.id,
        "os_id": os_obj.id,
        "etapa_id": etapa.id,
    }

    # Garante pasta principal da OS
    pasta_os_id = criar_pasta_os(os_obj)
    if not pasta_os_id:
        return None

    service = get_drive_service(oficina)
    if not service:
        logger.warning(
            "Drive subpasta etapa sem servico",
            extra=extra_log,
        )
        return None

    # 1) Tenta localizar uma pasta com esse nome dentro da pasta da OS
    try:
        query = (
            f"'{pasta_os_id}' in parents and "
            f"name = '{etapa.nome}' and "
            "mimeType = 'application/vnd.google-apps.folder' and "
            "trashed = false"
        )
        response = service.files().list(q=query, fields="files(id, name)", spaces='drive').execute()
        files = response.get('files', [])
        if files:
            return files[0]['id']
    except Exception:
        logger.exception(
            "Drive subpasta etapa falha ao listar",
            extra=extra_log,
        )

    # 2) Se não encontrou, cria
    folder_metadata = {
        'name': etapa.nome,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [pasta_os_id],
    }
    try:
        folder = service.files().create(body=folder_metadata, fields='id').execute()
        return folder.get('id')
    except Exception:
        logger.exception(
            "Drive subpasta etapa falha ao criar",
            extra=extra_log,
        )
        return None


def upload_foto_para_drive(foto: FotoOS) -> Optional[str]:
    """
    Envia o arquivo da FotoOS para o Google Drive na subpasta da etapa.
    Atualiza foto.drive_file_id.
    """
    os_obj = foto.os
    etapa = foto.etapa
    oficina = os_obj.oficina
    extra_log = {
        "oficina_id": os_obj.oficina_id,
        "os_id": os_obj.id,
        "foto_id": foto.id,
    }

    # Se já foi enviada, não faz de novo
    if foto.drive_file_id:
        return foto.drive_file_id

    # Caminho local do arquivo
    if not foto.arquivo:
        logger.warning(
            f"Foto {foto.id} não possui arquivo associado.",
            extra=extra_log,
        )
        return None

    local_path = foto.arquivo.path

    subpasta_id = _get_or_create_subpasta_etapa(os_obj, etapa)
    if not subpasta_id:
        return None

    service = get_drive_service(oficina)
    if not service:
        logger.warning("Serviço do Drive indisponível", extra=extra_log)
        return None

    file_metadata = {
        'name': os.path.basename(local_path),
        'parents': [subpasta_id],
    }
    media = MediaFileUpload(local_path, resumable=True)

    try:
        created = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id'
        ).execute()
        file_id = created.get('id')
        foto.drive_file_id = file_id
        foto.save(update_fields=['drive_file_id'])
        return file_id
    except Exception as e:
        logger.exception(
            f"Erro ao enviar foto {foto.id} para o Drive: {e}",
            extra=extra_log,
        )
        return None

def criar_subpastas_etapas(os_obj: OS, service):
    """
    Cria as subpastas das etapas da oficina dentro da pasta da OS.
    """
    etapas = (
        Etapa.objects
        .filter(oficina=os_obj.oficina, ativa=True)
        .order_by("ordem", "id")
    )

    for etapa in etapas:
        ordem = int(etapa.ordem or 0)
        nome_pasta = f"{ordem:02d} - {etapa.nome}"
        subpasta_id = _get_or_create_subpasta(
            service=service,
            parent_id=os_obj.drive_folder_id,
            nome=nome_pasta,
            os_obj=os_obj,
            etapa_id=etapa.id,
        )
        if not subpasta_id:
            logger.warning(
                "Drive subpasta etapa indisponivel",
                extra={
                    "oficina_id": os_obj.oficina_id,
                    "os_id": os_obj.id,
                    "etapa_id": etapa.id,
                },
            )

def criar_pasta_livres(os_obj: OS, service):
    subpasta_id = _get_or_create_subpasta(
        service=service,
        parent_id=os_obj.drive_folder_id,
        nome="00 - Livres",
        os_obj=os_obj,
    )
    if not subpasta_id:
        logger.warning(
            "Drive subpasta livres indisponivel",
            extra={"oficina_id": os_obj.oficina_id, "os_id": os_obj.id},
        )


def _get_or_create_subpasta(service, parent_id: str, nome: str, *, os_obj: OS = None, etapa_id=None) -> Optional[str]:
    """
    Busca uma subpasta pelo nome dentro de parent_id.
    Se não existir, cria.
    Retorna o folder_id.
    """
    extra_log = {
        "drive_folder_id": parent_id,
    }
    if os_obj:
        extra_log.update({"os_id": os_obj.id, "oficina_id": os_obj.oficina_id})
    if etapa_id:
        extra_log["etapa_id"] = etapa_id

    query = (
        f"mimeType='application/vnd.google-apps.folder' "
        f"and name='{nome}' "
        f"and '{parent_id}' in parents "
        f"and trashed=false"
    )

    try:
        response = service.files().list(
            q=query,
            fields="files(id, name)",
            pageSize=1,
        ).execute()

        files = response.get("files", [])
        if files:
            return files[0]["id"]
    except Exception:
        logger.exception(
            "Drive subpasta falha ao listar",
            extra={**extra_log, "nome": nome},
        )
        return None

    folder_metadata = {
        "name": nome,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }

    try:
        folder = service.files().create(
            body=folder_metadata,
            fields="id",
        ).execute()
    except Exception:
        logger.exception(
            "Drive subpasta falha ao criar",
            extra={**extra_log, "nome": nome},
        )
        return None

    return folder.get("id")

def obter_pasta_etapa(os_obj: OS, etapa, service) -> Optional[str]:
    """
    Retorna o folder_id da subpasta da etapa dentro da OS.
    Cria se não existir.
    """
    ordem = int(etapa.ordem or 0)
    nome_pasta = f"{ordem:02d} - {etapa.nome}"

    return _get_or_create_subpasta(
        service=service,
        parent_id=os_obj.drive_folder_id,
        nome=nome_pasta,
        os_obj=os_obj,
        etapa_id=getattr(etapa, "id", None),
    )

def upload_foto_os_drive(
    *,
    os_obj: OS,
    etapa,
    caminho_arquivo_local: str,
    nome_arquivo: str,
) -> Optional[str]:
    """
    Faz upload de uma foto da OS para a pasta correta da etapa.
    Retorna o file_id do Drive ou None em caso de falha.
    """
    extra_log = {
        "oficina_id": os_obj.oficina_id,
        "os_id": os_obj.id,
        "etapa_id": getattr(etapa, "id", None),
    }

    try:
        pasta_os_id = criar_pasta_os(os_obj)
    except Exception:
        logger.exception("Erro ao garantir pasta da OS no Drive", extra=extra_log)
        return None

    if not pasta_os_id:
        logger.warning("Pasta da OS indisponível no Drive", extra=extra_log)
        return None

    service = get_drive_service(os_obj.oficina)
    if not service:
        logger.warning("Serviço do Drive indisponível", extra=extra_log)
        return None

    try:
        pasta_etapa_id = obter_pasta_etapa(os_obj, etapa, service)
    except Exception:
        logger.exception("Erro ao obter pasta da etapa no Drive", extra=extra_log)
        return None

    if not pasta_etapa_id:
        logger.warning("Drive pasta etapa indisponivel", extra=extra_log)
        return None

    file_metadata = {
        "name": nome_arquivo,
        "parents": [pasta_etapa_id],
    }

    media = MediaFileUpload(
        caminho_arquivo_local,
        resumable=False,
    )

    try:
        file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id",
        ).execute()
        return file.get("id")
    except Exception:
        logger.exception(
            "Erro ao enviar foto para o Drive",
            extra={**extra_log, "arquivo": nome_arquivo},
        )
        return None

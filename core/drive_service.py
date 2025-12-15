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
    creds = _get_credentials(oficina)
    service = build('drive', 'v3', credentials=creds)
    return service


def criar_pasta_os(os_obj: OS) -> Optional[str]:
    """
    Cria (ou garante) a pasta da OS no Google Drive.
    Salva o ID em os_obj.drive_folder_id.
    """
    oficina = os_obj.oficina
    logger.info("Iniciando criar_pasta_os para OS id=%s codigo=%s oficina_id=%s",
                os_obj.id, os_obj.codigo, oficina.id)

    # Se já tiver pasta, não recria
    if os_obj.drive_folder_id:
        logger.info(
            "OS id=%s já possui drive_folder_id=%s, não será recriada.",
            os_obj.id,
            os_obj.drive_folder_id,
        )
        return os_obj.drive_folder_id

    # Busca config da oficina
    try:
        config = _get_oficina_drive_config(oficina)
        logger.debug(
            "Config Drive encontrada para oficina_id=%s: root_folder_id=%s ativo=%s",
            oficina.id,
            config.root_folder_id,
            config.ativo,
        )
    except DriveNaoConfigurado as e:
        logger.warning(
            "DriveNaoConfigurado para oficina_id=%s: %s",
            oficina.id,
            e,
        )
        return None
    except Exception:
        logger.exception(
            "Erro inesperado ao obter config do Drive para oficina_id=%s",
            oficina.id,
        )
        return None

    # Cria serviço do Drive
    try:
        service = get_drive_service(oficina)
        logger.debug("Serviço do Drive inicializado para oficina_id=%s", oficina.id)
    except Exception:
        logger.exception(
            "Erro ao inicializar serviço do Drive para oficina_id=%s",
            oficina.id,
        )
        return None

    # Monta os dados da pasta
    nome_pasta = f"OS-{os_obj.codigo} - {os_obj.placa or ''} - {os_obj.modelo_veiculo or ''}".strip()
    folder_metadata = {
        "name": nome_pasta,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [config.root_folder_id],
    }
    logger.debug(
        "Criando pasta no Drive para OS id=%s com metadata=%s",
        os_obj.id,
        folder_metadata,
    )

    # Chama API do Drive
    try:
        folder = service.files().create(body=folder_metadata, fields="id").execute()
        folder_id = folder.get("id")
        logger.info(
            "Pasta criada no Drive para OS id=%s: folder_id=%s",
            os_obj.id,
            folder_id,
        )
        os_obj.drive_folder_id = folder_id
        os_obj.save(update_fields=["drive_folder_id"])

        # Cria subpastas das etapas
        try:
            criar_subpastas_etapas(os_obj, service)
            criar_pasta_livres(os_obj, service)
            logger.info("Subpastas de etapas criadas para OS id=%s", os_obj.id)
        except Exception:
            logger.exception(
                "Erro ao criar subpastas da OS id=%s",
                os_obj.id,
            )

        return folder_id


    except Exception:
        logger.exception(
            "Erro ao criar pasta da OS id=%s no Drive.",
            os_obj.id,
        )
        return None



def _get_or_create_subpasta_etapa(os_obj: OS, etapa: Etapa) -> Optional[str]:
    """
    Garante uma subpasta com o nome da etapa dentro da pasta da OS.
    Retorna o ID da subpasta.
    """
    oficina = os_obj.oficina

    # Garante pasta principal da OS
    pasta_os_id = criar_pasta_os(os_obj)
    if not pasta_os_id:
        return None

    try:
        service = get_drive_service(oficina)
    except Exception as e:
        logger.exception(f"Erro ao obter serviço do Drive para oficina {oficina.id}: {e}")
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
    except Exception as e:
        logger.exception(f"Erro ao procurar subpasta da etapa '{etapa.nome}' na OS {os_obj.id}: {e}")

    # 2) Se não encontrou, cria
    folder_metadata = {
        'name': etapa.nome,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [pasta_os_id],
    }
    try:
        folder = service.files().create(body=folder_metadata, fields='id').execute()
        return folder.get('id')
    except Exception as e:
        logger.exception(f"Erro ao criar subpasta da etapa '{etapa.nome}' na OS {os_obj.id}: {e}")
        return None


def upload_foto_para_drive(foto: FotoOS) -> Optional[str]:
    """
    Envia o arquivo da FotoOS para o Google Drive na subpasta da etapa.
    Atualiza foto.drive_file_id.
    """
    os_obj = foto.os
    etapa = foto.etapa
    oficina = os_obj.oficina

    # Se já foi enviada, não faz de novo
    if foto.drive_file_id:
        return foto.drive_file_id

    # Caminho local do arquivo
    if not foto.arquivo:
        logger.warning(f"Foto {foto.id} não possui arquivo associado.")
        return None

    local_path = foto.arquivo.path

    subpasta_id = _get_or_create_subpasta_etapa(os_obj, etapa)
    if not subpasta_id:
        return None

    try:
        service = get_drive_service(oficina)
    except Exception as e:
        logger.exception(f"Erro ao obter serviço do Drive para oficina {oficina.id}: {e}")
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
        logger.exception(f"Erro ao enviar foto {foto.id} para o Drive: {e}")
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
        _get_or_create_subpasta(
            service=service,
            parent_id=os_obj.drive_folder_id,
            nome=nome_pasta,
        )

def criar_pasta_livres(os_obj: OS, service):
    _get_or_create_subpasta(
        service=service,
        parent_id=os_obj.drive_folder_id,
        nome="00 - Livres",
    )


def _get_or_create_subpasta(service, parent_id: str, nome: str) -> str:
    """
    Busca uma subpasta pelo nome dentro de parent_id.
    Se não existir, cria.
    Retorna o folder_id.
    """
    query = (
        f"mimeType='application/vnd.google-apps.folder' "
        f"and name='{nome}' "
        f"and '{parent_id}' in parents "
        f"and trashed=false"
    )

    response = service.files().list(
        q=query,
        fields="files(id, name)",
        pageSize=1,
    ).execute()

    files = response.get("files", [])
    if files:
        return files[0]["id"]

    folder_metadata = {
        "name": nome,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }

    folder = service.files().create(
        body=folder_metadata,
        fields="id",
    ).execute()

    return folder["id"]

def obter_pasta_etapa(os_obj: OS, etapa, service) -> str:
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
    )

def upload_foto_os_drive(
    *,
    os_obj: OS,
    etapa,
    caminho_arquivo_local: str,
    nome_arquivo: str,
) -> str:
    """
    Faz upload de uma foto da OS para a pasta correta da etapa.
    Retorna o file_id do Drive.
    """
    # Garante pasta da OS
    pasta_os_id = criar_pasta_os(os_obj)
    if not pasta_os_id:
        raise Exception("Pasta da OS não disponível no Drive")

    service = get_drive_service(os_obj.oficina)

    # Garante pasta da etapa
    pasta_etapa_id = obter_pasta_etapa(os_obj, etapa, service)

    file_metadata = {
        "name": nome_arquivo,
        "parents": [pasta_etapa_id],
    }

    media = MediaFileUpload(
        caminho_arquivo_local,
        resumable=False,
    )

    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields="id",
    ).execute()

    return file["id"]

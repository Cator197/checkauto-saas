import hashlib
import logging
from typing import List, Optional, Tuple

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from core.models import Etapa, FotoOS, OS, Oficina, UsuarioOficina
from core.serializers import (
    OSSerializer,
    SyncFotoSerializer,
    SyncOSPayloadSerializer,
    SyncRequestSerializer,
)
from core.services.fotos import criar_foto_os
from core.utils import get_oficina_do_usuario
from core.drive_service import criar_pasta_os, upload_foto_para_drive

logger = logging.getLogger("core.views")


class SyncService:
    def __init__(self, user):
        self.user = user
        self.oficina = self._definir_oficina()

    def _definir_oficina(self) -> Optional[Oficina]:
        oficina = get_oficina_do_usuario(self.user)
        if oficina is None and self.user.is_superuser:
            oficina = Oficina.objects.first()
        return oficina

    def processar(self, payload: dict) -> Tuple[List[dict], Optional[dict]]:
        if not self.oficina:
            return [], {
                "detail": "Usuário não está vinculado a nenhuma oficina ativa e nenhuma oficina padrão foi encontrada.",
            }

        serializer = SyncRequestSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        itens = serializer.validated_data.get("osPendentes", [])

        resultados = []
        for item in itens:
            resultado = self._processar_item(item)
            resultados.append(resultado)

        return resultados, None

    def _processar_item(self, item: dict) -> dict:
        local_id = item.get("local_id") or item.get("id")
        try:
            os_payload = self._converter_payload_pwa(item)
        except serializers.ValidationError as exc:
            return {
                "local_id": local_id,
                "status": "error",
                "os_id": None,
                "errors": exc.detail,
                "photo_errors": [],
            }

        os_obj = None
        photo_errors: List[str] = []
        status_item = "created"

        with transaction.atomic():
            os_obj, status_item, errors = self._salvar_os(os_payload)
            if errors:
                return {
                    "local_id": local_id,
                    "status": "error",
                    "os_id": None,
                    "errors": errors,
                    "photo_errors": [],
                }

            photo_errors = self._salvar_fotos(os_obj, item)

        return {
            "local_id": local_id,
            "status": status_item,
            "os_id": os_obj.id if os_obj else None,
            "errors": [],
            "photo_errors": photo_errors,
        }

    def _converter_payload_pwa(self, item: dict) -> dict:
        dados_os = SyncOSPayloadSerializer(data=item)
        dados_os.is_valid(raise_exception=True)
        veiculo = dados_os.validated_data.get("veiculo", {}) or {}
        os_data = dados_os.validated_data.get("os", {}) or {}
        cliente = dados_os.validated_data.get("cliente", {}) or {}

        modelo_veiculo = (veiculo.get("modelo") or "").strip() or None
        if not modelo_veiculo:
            raise serializers.ValidationError({"modelo_veiculo": "Modelo do veículo não pode ser vazio."})

        numero_interno = os_data.get("numeroInterno") or veiculo.get("placa")
        if not numero_interno:
            numero_interno = f"PWA-{timezone.now().strftime('%Y%m%d%H%M%S')}"
        numero_interno = numero_interno.strip() if numero_interno else numero_interno

        etapa_atual = os_data.get("etapa_atual") or os_data.get("etapaAtual")

        payload = {
            "oficina": self.oficina.id,
            "codigo": numero_interno,
            "placa": veiculo.get("placa"),
            "modelo_veiculo": modelo_veiculo,
            "cor_veiculo": veiculo.get("cor"),
            "nome_cliente": cliente.get("nome"),
            "telefone_cliente": cliente.get("telefone"),
            "observacoes": os_data.get("observacoes"),
            "etapa_atual": etapa_atual,
            "data_entrada": timezone.now(),
            "aberta": True,
        }

        if payload.get("etapa_atual") is None:
            etapa_padrao = self._buscar_primeira_etapa_ativa(self.oficina)
            if etapa_padrao:
                payload["etapa_atual"] = etapa_padrao.id
                logger.info(
                    "[SYNC] etapa_atual ausente; aplicando etapa inicial da oficina.",
                    extra={
                        "oficina_id": self.oficina.id,
                        "os_codigo": numero_interno,
                        "etapa_id": etapa_padrao.id,
                    },
                )
            else:
                logger.warning(
                    "[SYNC] etapa_atual ausente e nenhuma etapa ativa encontrada na oficina.",
                    extra={"oficina_id": self.oficina.id, "os_codigo": numero_interno},
                )

        return payload

    def _buscar_primeira_etapa_ativa(self, oficina: Oficina) -> Optional[Etapa]:
        return (
            Etapa.objects.filter(oficina=oficina, ativa=True)
            .order_by("ordem")
            .first()
        )

    def _salvar_os(self, payload: dict) -> Tuple[Optional[OS], str, Optional[dict]]:
        os_existente = (
            OS.objects.select_for_update()
            .filter(oficina=self.oficina, codigo=payload.get("codigo"))
            .first()
        )

        if os_existente:
            serializer = OSSerializer(
                instance=os_existente,
                data=payload,
                context={"request": None},
                partial=True,
            )
            if not serializer.is_valid():
                return None, "error", serializer.errors

            alteracoes = serializer.validated_data
            houve_mudanca = any(
                getattr(os_existente, campo) != valor for campo, valor in alteracoes.items()
            )

            os_obj = serializer.save()
            status_item = "updated" if houve_mudanca else "skipped"
        else:
            serializer = OSSerializer(
                data=payload,
                context={"request": None},
            )
            if not serializer.is_valid():
                return None, "error", serializer.errors

            os_obj = serializer.save(oficina=self.oficina)
            status_item = "created"

        try:
            criar_pasta_os(os_obj)
        except Exception:
            logger.warning(
                "[SYNC] Erro ao criar pasta da OS %s no Drive",
                os_obj.id,
                exc_info=True,
                extra={"oficina_id": self.oficina.id, "os_id": os_obj.id},
            )

        return os_obj, status_item, None

    def _salvar_fotos(self, os_obj: OS, item: dict) -> List[str]:
        photo_errors: List[str] = []

        fotos = item.get("fotos", {}) or {}
        todas_fotos = []
        todas_fotos.extend(fotos.get("padrao", []) or [])
        todas_fotos.extend(fotos.get("livres", []) or [])

        if not todas_fotos:
            return photo_errors

        etapa = os_obj.etapa_atual
        if etapa is None:
            etapa = Etapa.objects.filter(oficina=os_obj.oficina, is_checkin=True).first()
        if etapa is None:
            etapa = Etapa.objects.filter(oficina=os_obj.oficina).order_by("ordem", "id").first()
        if etapa is None:
            message = "[SYNC] Sem etapas cadastradas para oficina. Fotos ignoradas."
            logger.warning(
                message,
                extra={
                    "user_id": self.user.id,
                    "oficina_id": os_obj.oficina_id,
                    "os_codigo": os_obj.codigo,
                },
            )
            photo_errors.append(message)
            return photo_errors

        usuario_oficina = UsuarioOficina.objects.filter(
            user=self.user, oficina=os_obj.oficina, ativo=True
        ).first()

        assinaturas_existentes = self._assinaturas_fotos_existentes(os_obj)

        for idx, foto in enumerate(todas_fotos):
            foto_serializer = SyncFotoSerializer(data=foto)
            if not foto_serializer.is_valid():
                photo_errors.append(foto_serializer.errors)
                continue

            assinatura = self._assinatura_foto_payload(foto)
            if assinatura and assinatura in assinaturas_existentes:
                photo_errors.append("Foto ignorada: já existente para esta OS.")
                continue

            extra_log = {
                "user_id": self.user.id,
                "oficina_id": os_obj.oficina_id,
                "os_codigo": os_obj.codigo,
                "foto_idx": idx,
            }

            foto_obj, error_message = criar_foto_os(
                foto=foto,
                os_obj=os_obj,
                etapa=etapa,
                usuario_oficina=usuario_oficina,
                extra_log=extra_log,
            )

            if error_message:
                photo_errors.append(error_message)
                continue

            if assinatura:
                assinaturas_existentes.add(assinatura)

            try:
                upload_foto_para_drive(foto_obj)
            except Exception as e:
                message = f"[SYNC] Erro ao enviar foto {foto_obj.id} para o Drive: {e}"
                logger.warning(
                    message,
                    extra={
                        "user_id": self.user.id,
                        "oficina_id": os_obj.oficina_id,
                        "os_codigo": os_obj.codigo,
                        "foto_idx": idx,
                    },
                )
                photo_errors.append(message)

        return photo_errors

    def _assinatura_foto_payload(self, foto: dict) -> Optional[Tuple[str, str]]:
        local_id = foto.get("local_id") or foto.get("id")
        if local_id:
            return ("local_id", str(local_id))

        conteudo_base64 = foto.get("arquivo")
        if isinstance(conteudo_base64, dict):
            conteudo_base64 = conteudo_base64.get("dataUrl") or conteudo_base64.get("arquivo")
        if not conteudo_base64:
            conteudo_base64 = foto.get("dataUrl")
        if not conteudo_base64 or not isinstance(conteudo_base64, str):
            return None

        if conteudo_base64.startswith("data:") and "," in conteudo_base64:
            _, conteudo_base64 = conteudo_base64.split(",", 1)
        elif "," in conteudo_base64:
            conteudo_base64 = conteudo_base64.split(",", 1)[1]

        try:
            conteudo = conteudo_base64.encode()
            digest = hashlib.sha256(conteudo).hexdigest()
            return ("hash", digest)
        except Exception:
            return None

    def _assinaturas_fotos_existentes(self, os_obj: OS) -> set:
        assinaturas = set()
        for foto in FotoOS.objects.filter(os=os_obj):
            if foto.arquivo and hasattr(foto.arquivo, "open"):
                try:
                    with foto.arquivo.open("rb") as fp:
                        conteudo = fp.read()
                        digest = hashlib.sha256(conteudo).hexdigest()
                        assinaturas.add(("hash", digest))
                except Exception:
                    continue
        return assinaturas

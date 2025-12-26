import json
import logging
from datetime import date

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import redirect
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from google_auth_oauthlib.flow import Flow
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .drive_service import criar_pasta_os, upload_foto_os_drive, upload_foto_para_drive
from .models import (
    ConfigFoto,
    Etapa,
    FotoOS,
    OS,
    OSEtapaStatus,
    ObservacaoEtapaOS,
    Oficina,
    OficinaDriveConfig,
    UsuarioOficina,
)
from .serializers import (
    ConfigFotoSerializer,
    EtapaSerializer,
    FotoOSSerializer,
    ObservacaoEtapaOSSerializer,
    OSSerializer,
    OficinaSerializer,
    PwaVeiculoEmProducaoSerializer,
    UsuarioOficinaSerializer,
)
from .permissions import (
    IsFotoOSPermission,
    IsOficinaAdmin,
    IsOficinaAdminOrReadOnly,
    IsOficinaUser,
    IsOSPermission,
)
from .utils import get_oficina_do_usuario, get_papel_do_usuario

logger = logging.getLogger(__name__)


class AuthMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        payload = {
            "id": user.id,
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
        }

        oficina = get_oficina_do_usuario(user)
        if oficina is not None:
            payload["oficina_id"] = oficina.id

        papel = get_papel_do_usuario(user, getattr(request, "auth", None))
        if papel:
            payload["papel"] = papel

        return Response(payload)


class OficinaViewSet(viewsets.ModelViewSet):
    queryset = Oficina.objects.all()  # <-- necessário pro router
    serializer_class = OficinaSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if user.is_superuser:
            return Oficina.objects.all()

        oficina = get_oficina_do_usuario(user)
        if oficina is None:
            return Oficina.objects.none()

        return Oficina.objects.filter(id=oficina.id)


class UsuarioOficinaViewSet(viewsets.ModelViewSet):
    queryset = UsuarioOficina.objects.select_related('user', 'oficina').all()
    serializer_class = UsuarioOficinaSerializer
    permission_classes = [IsAuthenticated, IsOficinaAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user

        if user.is_superuser:
            return UsuarioOficina.objects.select_related('user', 'oficina').all()

        oficina = get_oficina_do_usuario(user)
        if oficina is None:
            return UsuarioOficina.objects.none()

        return UsuarioOficina.objects.select_related('user', 'oficina').filter(oficina=oficina)


class EtapaViewSet(viewsets.ModelViewSet):
    queryset = Etapa.objects.select_related('oficina').all()
    serializer_class = EtapaSerializer
    permission_classes = [IsAuthenticated, IsOficinaAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user

        if user.is_superuser:
            return Etapa.objects.select_related('oficina').order_by('ordem', 'id')

        oficina = get_oficina_do_usuario(user)
        if oficina is None:
            return Etapa.objects.none()

        return (
            Etapa.objects.select_related('oficina')
            .filter(oficina=oficina)
            .order_by('ordem', 'id')
        )

    def perform_create(self, serializer):
        """
        Ao criar uma etapa pelo painel, a oficina vem do usuário logado,
        não do payload do front.
        """
        user = self.request.user

        oficina = get_oficina_do_usuario(user)

        if oficina is None and not user.is_superuser:
            # Se por algum motivo o usuário não tiver oficina associada
            raise serializers.ValidationError({"oficina": "Oficina não encontrada para o usuário."})

        # Para superuser, se quiser, poderia aceitar oficina vinda no payload.
        serializer.save(oficina=oficina)

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            return [IsAuthenticated(), IsOficinaUser()]

        return [IsAuthenticated(), IsOficinaAdminOrReadOnly()]


from rest_framework import serializers  # garantir que está importado

class ConfigFotoViewSet(viewsets.ModelViewSet):
    queryset = ConfigFoto.objects.select_related('oficina', 'etapa').all()
    serializer_class = ConfigFotoSerializer
    permission_classes = [IsAuthenticated, IsOficinaAdminOrReadOnly]

    def get_queryset(self):
        user = self.request.user

        if user.is_superuser:
            qs = ConfigFoto.objects.select_related('oficina', 'etapa').all()
        else:
            oficina = get_oficina_do_usuario(user)
            if oficina is None:
                return ConfigFoto.objects.none()
            qs = ConfigFoto.objects.select_related('oficina', 'etapa').filter(oficina=oficina)

        etapa_id = self.request.query_params.get("etapa")
        if etapa_id:
            qs = qs.filter(etapa_id=etapa_id)

        return qs.order_by("etapa__ordem", "ordem", "id")

    def perform_create(self, serializer):
        user = self.request.user
        oficina = get_oficina_do_usuario(user)

        if oficina is None and not user.is_superuser:
            raise serializers.ValidationError({"oficina": "Nenhuma oficina associada ao usuário."})

        serializer.save(oficina=oficina)



class OSViewSet(viewsets.ModelViewSet):
    queryset = OS.objects.select_related('oficina', 'etapa_atual').prefetch_related(
        'observacoes_etapas__etapa', 'observacoes_etapas__criado_por__user'
    )
    serializer_class = OSSerializer
    permission_classes = [IsAuthenticated, IsOSPermission]

    def get_queryset(self):
        """
        Lista de OS filtrada pela oficina do usuário e pelos parâmetros da consulta:
        - search: código, placa ou nome do cliente
        - status: 'aberta' ou 'fechada'
        - etapa: id da etapa_atual
        """
        user = self.request.user

        # Base: filtra por oficina
        base_qs = OS.objects.select_related('oficina', 'etapa_atual').prefetch_related(
            'observacoes_etapas__etapa', 'observacoes_etapas__criado_por__user'
        )

        if user.is_superuser:
            qs = base_qs.all()
        else:
            oficina = get_oficina_do_usuario(user)
            if oficina is None:
                return OS.objects.none()

            qs = base_qs.filter(oficina=oficina)

        params = self.request.query_params

        # 🔍 Busca geral
        search = params.get("search")
        if search:
            search = search.strip()
            if search:
                qs = qs.filter(
                    Q(codigo__icontains=search) |
                    Q(placa__icontains=search) |
                    Q(nome_cliente__icontains=search)
                )

        # 🎫 Filtro por status (campo 'aberta' boolean)
        status_param = params.get("status")
        if status_param == "aberta":
            qs = qs.filter(aberta=True)
        elif status_param == "fechada":
            qs = qs.filter(aberta=False)

        # 🛠️ Filtro por etapa atual
        etapa_id = params.get("etapa")
        if etapa_id:
            qs = qs.filter(etapa_atual_id=etapa_id)

        # Ordenação padrão: OS mais recentes primeiro
        qs = qs.order_by("-data_entrada", "-criado_em")

        return qs

    def perform_create(self, serializer):
        """
        - Garante que a OS pertence à oficina do usuário logado
        - Cria a pasta da OS no Google Drive logo após salvar (para o fluxo do painel)
        """
        user = self.request.user
        oficina = get_oficina_do_usuario(user)

        if oficina is None:
            if user.is_superuser:
                oficina_id = self.request.data.get("oficina")
                if not oficina_id:
                    raise serializers.ValidationError({"oficina": "Superusuário precisa informar a oficina."})
                try:
                    oficina = Oficina.objects.get(id=oficina_id)
                except Oficina.DoesNotExist:
                    raise serializers.ValidationError({"oficina": "Oficina informada não existe."})
            else:
                # Se por algum motivo o usuário não tiver oficina associada
                raise serializers.ValidationError({"oficina": "Oficina não encontrada para o usuário."})

        os_obj = serializer.save(oficina=oficina)

        # Tenta criar a pasta da OS no Drive
        try:
            logger.info("Chamando criar_pasta_os para OS id=%s codigo=%s", os_obj.id, os_obj.codigo)
            criar_pasta_os(os_obj)
        except Exception:
            logger.exception(
                "Erro ao criar pasta no Drive para OS",
                extra={"oficina_id": oficina.id, "os_id": os_obj.id},
            )

    def _get_usuario_oficina(self, os_obj):
        return UsuarioOficina.objects.filter(
            user=self.request.user, oficina=os_obj.oficina, ativo=True
        ).first()

    def _is_operador(self, request):
        papel = get_papel_do_usuario(request.user, getattr(request, "auth", None))
        return papel == "OPERADOR"

    def _montar_timeline(self, os_obj):
        etapas = (
            Etapa.objects.filter(oficina=os_obj.oficina, ativa=True)
            .order_by("ordem", "id")
            .all()
        )

        status_map = {
            item.etapa_id: item
            for item in OSEtapaStatus.objects.filter(os=os_obj, etapa__in=etapas)
        }

        timeline = []
        for etapa in etapas:
            status_obj = status_map.get(etapa.id)
            concluida_em = status_obj.concluida_em if status_obj else None

            timeline.append(
                {
                    "etapa": etapa.id,
                    "etapa_nome": etapa.nome,
                    "ordem": etapa.ordem,
                    "status": "concluida" if concluida_em else "pendente",
                    "concluida_em": concluida_em,
                    "is_atual": os_obj.etapa_atual_id == etapa.id,
                }
            )

        return timeline

    def _obter_etapa_da_os(self, os_obj, etapa_id):
        try:
            return Etapa.objects.get(id=etapa_id, oficina=os_obj.oficina)
        except Etapa.DoesNotExist:
            return None

    def _parse_data_conclusao(self, valor):
        if not valor:
            return None

        if isinstance(valor, str):
            parsed = parse_datetime(valor)
            if parsed:
                return parsed

        return None

    def _salvar_observacao_etapa(self, *, os_obj, etapa, instance=None, payload=None, partial=False):
        serializer = ObservacaoEtapaOSSerializer(
            instance=instance,
            data=payload,
            partial=partial,
            context={"request": self.request, "os": os_obj},
        )
        serializer.is_valid(raise_exception=True)

        usuario_oficina = self._get_usuario_oficina(os_obj)
        criado_por = instance.criado_por if instance else usuario_oficina

        return serializer.save(
            os=os_obj,
            etapa=etapa,
            criado_por=criado_por,
        )

    @action(detail=True, methods=["get"], url_path="observacoes")
    def listar_observacoes(self, request, pk=None):
        os_obj = self.get_object()

        observacoes = (
            ObservacaoEtapaOS.objects.filter(os=os_obj)
            .select_related("etapa")
            .order_by("etapa__ordem", "etapa_id")
        )

        serializer = ObservacaoEtapaOSSerializer(
            observacoes, many=True, context={"request": request, "os": os_obj}
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="observacoes")
    def criar_ou_atualizar_observacao(self, request, pk=None):
        os_obj = self.get_object()

        etapa_id = request.data.get("etapa")
        if etapa_id:
            try:
                etapa = Etapa.objects.get(id=etapa_id, oficina=os_obj.oficina)
            except Etapa.DoesNotExist:
                return Response(
                    {"detail": "Etapa não encontrada para esta oficina."},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            if not os_obj.etapa_atual:
                return Response(
                    {"detail": "OS não possui etapa atual para associar a observação."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            etapa = os_obj.etapa_atual

        payload = {
            "etapa": etapa.id,
            "texto": request.data.get("texto", ""),
        }

        instance = ObservacaoEtapaOS.objects.filter(os=os_obj, etapa=etapa).first()

        observacao = self._salvar_observacao_etapa(
            os_obj=os_obj,
            etapa=etapa,
            instance=instance,
            payload=payload,
            partial=instance is not None,
        )

        return Response(
            ObservacaoEtapaOSSerializer(
                observacao, context={"request": request, "os": os_obj}
            ).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["patch"], url_path=r"observacoes/(?P<etapa_id>[^/.]+)")
    def atualizar_observacao(self, request, pk=None, etapa_id=None):
        os_obj = self.get_object()

        try:
            instance = ObservacaoEtapaOS.objects.select_related("etapa").get(
                os=os_obj, etapa_id=etapa_id, etapa__oficina=os_obj.oficina
            )
        except ObservacaoEtapaOS.DoesNotExist:
            return Response(
                {"detail": "Observação não encontrada para esta OS/etapa."},
                status=status.HTTP_404_NOT_FOUND,
            )

        observacao = self._salvar_observacao_etapa(
            os_obj=os_obj,
            etapa=instance.etapa,
            instance=instance,
            payload=request.data,
            partial=True,
        )

        return Response(
            ObservacaoEtapaOSSerializer(
                observacao, context={"request": request, "os": os_obj}
            ).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["put"], url_path=r"etapas/(?P<etapa_id>[^/.]+)/observacao")
    def upsert_observacao_etapa(self, request, pk=None, etapa_id=None):
        os_obj = self.get_object()

        try:
            etapa = Etapa.objects.get(id=etapa_id, oficina=os_obj.oficina)
        except Etapa.DoesNotExist:
            return Response(
                {"detail": "Etapa não encontrada para esta oficina."},
                status=status.HTTP_404_NOT_FOUND,
            )

        payload = {"texto": request.data.get("texto", "")}

        observacao = ObservacaoEtapaOS.objects.filter(os=os_obj, etapa=etapa).first()

        serializer = ObservacaoEtapaOSSerializer(
            instance=observacao,
            data=payload,
            partial=True,
            context={"request": request, "os": os_obj},
        )
        serializer.is_valid(raise_exception=True)

        usuario_oficina = UsuarioOficina.objects.filter(
            user=request.user, oficina=os_obj.oficina, ativo=True
        ).first()

        criado_por = serializer.instance.criado_por if serializer.instance else None

        observacao = serializer.save(
            os=os_obj,
            etapa=etapa,
            criado_por=criado_por or usuario_oficina,
        )

        return Response(
            ObservacaoEtapaOSSerializer(observacao, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"], url_path="timeline")
    def timeline(self, request, pk=None):
        os_obj = self.get_object()
        return Response(self._montar_timeline(os_obj), status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="timeline/marcar-concluida")
    def marcar_etapa_concluida(self, request, pk=None):
        if self._is_operador(request):
            return Response(
                {"detail": "Operador não pode alterar etapas."},
                status=status.HTTP_403_FORBIDDEN,
            )

        os_obj = self.get_object()
        etapa_id = request.data.get("etapa")

        if not etapa_id:
            return Response(
                {"detail": "Campo etapa é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        etapa = self._obter_etapa_da_os(os_obj, etapa_id)
        if not etapa:
            return Response(
                {"detail": "Etapa não encontrada para esta OS."},
                status=status.HTTP_404_NOT_FOUND,
            )

        data_conclusao = self._parse_data_conclusao(request.data.get("concluida_em"))
        concluida_em = data_conclusao or timezone.now()

        with transaction.atomic():
            status_obj, _ = OSEtapaStatus.objects.select_for_update().get_or_create(
                os=os_obj, etapa=etapa
            )

            status_obj.concluida_em = concluida_em
            status_obj.save(update_fields=["concluida_em", "atualizado_em"])

            if os_obj.etapa_atual_id == etapa.id:
                proxima_etapa = (
                    Etapa.objects.filter(
                        oficina=os_obj.oficina,
                        ativa=True,
                        ordem__gt=etapa.ordem,
                    )
                    .order_by("ordem", "id")
                    .first()
                )

                os_obj.etapa_atual = proxima_etapa
                os_obj.save(update_fields=["etapa_atual", "atualizado_em"])

        return Response(
            {"timeline": self._montar_timeline(os_obj), "etapa_atual": os_obj.etapa_atual_id},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="timeline/reabrir")
    def reabrir_etapa(self, request, pk=None):
        if self._is_operador(request):
            return Response(
                {"detail": "Operador não pode alterar etapas."},
                status=status.HTTP_403_FORBIDDEN,
            )

        os_obj = self.get_object()
        etapa_id = request.data.get("etapa")

        if not etapa_id:
            return Response(
                {"detail": "Campo etapa é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        etapa = self._obter_etapa_da_os(os_obj, etapa_id)
        if not etapa:
            return Response(
                {"detail": "Etapa não encontrada para esta OS."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            status_obj, _ = OSEtapaStatus.objects.select_for_update().get_or_create(
                os=os_obj, etapa=etapa
            )

            status_obj.concluida_em = None
            status_obj.save(update_fields=["concluida_em", "atualizado_em"])

            if os_obj.etapa_atual is None or etapa.ordem <= os_obj.etapa_atual.ordem:
                os_obj.etapa_atual = etapa
                os_obj.save(update_fields=["etapa_atual", "atualizado_em"])

        return Response(
            {"timeline": self._montar_timeline(os_obj), "etapa_atual": os_obj.etapa_atual_id},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="avancar-etapa")
    def avancar_etapa(self, request, pk=None):
        """
        Avança a OS para a próxima etapa ativa, validando fotos obrigatórias.
        """

        if self._is_operador(request):
            return Response(
                {"detail": "Operador não pode alterar a etapa manualmente."},
                status=status.HTTP_403_FORBIDDEN,
            )

        os_obj = self.get_object()

        etapa_atual = os_obj.etapa_atual
        if etapa_atual is None:
            return Response(
                {"detail": "A OS não possui etapa atual definida."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        etapa_origem = request.data.get("etapa_origem")
        if etapa_origem is not None:
            try:
                etapa_origem = int(etapa_origem)
            except (TypeError, ValueError):
                etapa_origem = None

        if etapa_origem and etapa_atual.id != etapa_origem:
            serializer = OSSerializer(os_obj, context={"request": request})
            return Response(serializer.data, status=status.HTTP_200_OK)

        proxima_etapa = (
            Etapa.objects.filter(
                oficina=os_obj.oficina,
                ativa=True,
                ordem__gt=etapa_atual.ordem,
            )
            .order_by("ordem")
            .first()
        )

        if proxima_etapa is None:
            serializer = OSSerializer(os_obj, context={"request": request})
            data = serializer.data
            data["ultima_etapa"] = True
            return Response(data, status=status.HTTP_200_OK)

        configs_obrigatorias = list(
            ConfigFoto.objects.filter(
                oficina=os_obj.oficina,
                etapa=etapa_atual,
                obrigatoria=True,
                ativa=True,
            )
        )

        pendentes = [
            cfg
            for cfg in configs_obrigatorias
            if not FotoOS.objects.filter(
                os=os_obj, config_foto=cfg, tipo="PADRAO"
            ).exists()
        ]

        if pendentes:
            return Response(
                {
                    "detail": "Fotos obrigatórias pendentes na etapa atual.",
                    "configs_pendentes": [cfg.id for cfg in pendentes],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        observacao = request.data.get("observacao")

        with transaction.atomic():
            os_obj.etapa_atual = proxima_etapa

            fields_to_update = ["etapa_atual", "atualizado_em"]

            if observacao:
                os_obj.observacoes = (
                    f"{os_obj.observacoes}\n\n{observacao}"
                    if os_obj.observacoes
                    else observacao
                )
                fields_to_update.append("observacoes")

            os_obj.save(update_fields=fields_to_update)

        serializer = OSSerializer(os_obj, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

class FotoOSViewSet(viewsets.ModelViewSet):
    queryset = FotoOS.objects.select_related('os', 'etapa', 'config_foto', 'tirada_por').all()
    serializer_class = FotoOSSerializer
    permission_classes = [IsAuthenticated, IsFotoOSPermission]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        user = self.request.user

        qs = FotoOS.objects.select_related('os', 'etapa', 'config_foto', 'tirada_por').all()

        # Filtra por oficina do usuário (exceto superuser)
        if not user.is_superuser:
            oficina = get_oficina_do_usuario(user)
            if oficina is None:
                return FotoOS.objects.none()
            qs = qs.filter(os__oficina=oficina)

        # 🔹 Filtro por OS específica (?os=ID)
        os_id = self.request.query_params.get("os")
        if os_id:
            qs = qs.filter(os_id=os_id)

        # 🔹 Ordenação padrão: etapa, data da foto
        qs = qs.order_by("etapa__ordem", "tirada_em", "id")

        return qs

    def perform_create(self, serializer):
        from .models import UsuarioOficina

        user = self.request.user
        usuario_oficina = None
        oficina = get_oficina_do_usuario(user)
        if oficina:
            usuario_oficina = UsuarioOficina.objects.filter(
                user=user, oficina=oficina, ativo=True
            ).first()

        # salva a foto corretamente
        foto = serializer.save(tirada_por=usuario_oficina)

        # tenta subir pro drive
        try:
            if foto.etapa:
                drive_file_id = upload_foto_os_drive(
                    os_obj=foto.os,
                    etapa=foto.etapa,
                    caminho_arquivo_local=foto.arquivo.path,
                    nome_arquivo=foto.arquivo.name,
                )
                if drive_file_id:
                    foto.drive_file_id = drive_file_id
                    foto.save(update_fields=["drive_file_id"])
                else:
                    logger.warning(
                        "Upload do Drive indisponível para foto",
                        extra={
                            "oficina_id": foto.os.oficina_id,
                            "os_id": foto.os_id,
                            "foto_id": foto.id,
                        },
                    )
        except Exception:
            logger.exception(
                "Erro ao enviar foto para o Drive",
                extra={
                    "oficina_id": foto.os.oficina_id,
                    "os_id": foto.os_id,
                    "foto_id": foto.id,
                },
            )

    def destroy(self, request, *args, **kwargs):
        # Futuro: remover também do Drive quando integrado (S7-6 / melhorias futuras)
        return super().destroy(request, *args, **kwargs)


from django.utils import timezone

from .models import Etapa, UsuarioOficina, Oficina  # garante esses imports
from .services.fotos import criar_foto_os
from .services.sync import SyncService


class SyncView(APIView):
    """
    Endpoint especial para sincronização em lote das OS criadas offline no PWA.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        service = SyncService(request.user)
        resultados, erro = service.processar(request.data)

        if erro:
            return Response(erro, status=status.HTTP_400_BAD_REQUEST)

        return Response({"results": resultados, "os": resultados}, status=status.HTTP_200_OK)


class PwaVeiculosEmProducaoView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        user = request.user

        if user.is_superuser:
            queryset = OS.objects.select_related("etapa_atual", "oficina").filter(aberta=True)
        else:
            oficina = get_oficina_do_usuario(user)
            if oficina is None:
                return Response([], status=status.HTTP_200_OK)

            queryset = OS.objects.select_related("etapa_atual", "oficina").filter(
                oficina=oficina,
                aberta=True,
            )

        ordens = list(queryset.order_by("-atualizado_em"))

        if not ordens:
            return Response([], status=status.HTTP_200_OK)

        os_ids = [os_obj.id for os_obj in ordens]
        fotos_por_os = {}

        for foto in FotoOS.objects.filter(os_id__in=os_ids).select_related("etapa"):
            fotos_por_os.setdefault(foto.os_id, []).append(foto)

        primeira_etapa_cache = {}
        configs_cache = {}

        def obter_etapa_atual(os_obj):
            if os_obj.etapa_atual:
                return os_obj.etapa_atual

            oficina_id = os_obj.oficina_id
            if oficina_id not in primeira_etapa_cache:
                primeira_etapa_cache[oficina_id] = (
                    Etapa.objects.filter(oficina_id=oficina_id, ativa=True)
                    .order_by("ordem")
                    .first()
                )
            return primeira_etapa_cache[oficina_id]

        def obter_configs(oficina_id, etapa_id):
            chave = (oficina_id, etapa_id)
            if chave not in configs_cache:
                if etapa_id is None:
                    configs_cache[chave] = []
                else:
                    configs_cache[chave] = list(
                        ConfigFoto.objects.filter(
                            oficina_id=oficina_id,
                            etapa_id=etapa_id,
                            obrigatoria=True,
                            ativa=True,
                        ).values_list("id", flat=True)
                    )
            return configs_cache[chave]

        def build_drive_thumb(drive_file_id):
            if not drive_file_id:
                return None
            return f"https://drive.google.com/thumbnail?id={drive_file_id}&sz=w800"

        resposta = []

        for os_obj in ordens:
            etapa = obter_etapa_atual(os_obj)
            etapa_id = etapa.id if etapa else None
            config_ids = obter_configs(os_obj.oficina_id, etapa_id)
            fotos_da_os = fotos_por_os.get(os_obj.id, [])

            configs_atendidos = {
                foto.config_foto_id
                for foto in fotos_da_os
                if foto.config_foto_id in config_ids
            }
            faltantes = max(len(config_ids) - len(configs_atendidos), 0)

            thumb_url = None
            if etapa_id is not None:
                fotos_na_etapa = [f for f in fotos_da_os if f.etapa_id == etapa_id]
                if fotos_na_etapa:
                    ultima_foto = max(fotos_na_etapa, key=lambda f: (f.tirada_em, f.id))
                    thumb_url = build_drive_thumb(ultima_foto.drive_file_id)

            resposta.append(
                {
                    "os_id": os_obj.id,
                    "codigo": os_obj.codigo,
                    "placa": os_obj.placa,
                    "modelo_veiculo": os_obj.modelo_veiculo,
                    "etapa_atual": {
                        "id": etapa_id,
                        "nome": etapa.nome if etapa else None,
                    },
                    "faltam_fotos_obrigatorias": faltantes,
                    "thumb_url": thumb_url,
                }
            )

        serializer = PwaVeiculoEmProducaoSerializer(data=resposta, many=True)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProximaEtapaAPIView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [JWTAuthentication]

    def get(self, request):
        os_id = request.query_params.get("os")

        if not os_id:
            return Response(
                {"detail": "Parâmetro 'os' é obrigatório."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            os_id = int(os_id)
        except (TypeError, ValueError):
            return Response(
                {"detail": "Parâmetro 'os' inválido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        oficina_usuario = get_oficina_do_usuario(user)

        try:
            os_obj = OS.objects.select_related("oficina", "etapa_atual").get(id=os_id)
        except OS.DoesNotExist:
            return Response(
                {"detail": "OS não encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not user.is_superuser:
            if oficina_usuario is None or os_obj.oficina_id != oficina_usuario.id:
                return Response(
                    {"detail": "OS não encontrada para esta oficina."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        etapa_atual = os_obj.etapa_atual

        if etapa_atual is None:
            return Response(
                {"detail": "A OS não possui etapa atual definida."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        proxima_etapa = (
            Etapa.objects.filter(
                oficina=os_obj.oficina,
                ativa=True,
                ordem__gt=etapa_atual.ordem,
            )
            .order_by("ordem", "id")
            .first()
        )

        if proxima_etapa is None:
            return Response({"proxima_etapa": None}, status=status.HTTP_200_OK)

        return Response(
            {"proxima_etapa": {"id": proxima_etapa.id, "nome": proxima_etapa.nome}},
            status=status.HTTP_200_OK,
        )


class DashboardResumoView(APIView):
    """
    Retorna o resumo para o dashboard do painel web:
    - Total de OS abertas
    - Check-ins do dia (data_entrada = hoje)
    - Cards por etapa (somente mostrar_no_dashboard=True)
    """

    permission_classes = [IsAuthenticated]

    def get_oficina_do_usuario(self, request):
        """
        Ajuste este método de acordo com o relacionamento real entre User e Oficina.
        Aqui estou assumindo um model UsuarioOficina ligado ao User.
        """
        user = request.user

        # Se for superuser, pode ver todas as oficinas
        if user.is_superuser:
            return None

        usuario_oficina = getattr(user, "usuariooficina", None)
        if usuario_oficina:
            return usuario_oficina.oficina

        return None

    def get(self, request, *args, **kwargs):
        oficina = self.get_oficina_do_usuario(request)

        qs_os = OS.objects.all()
        if oficina is not None:
            qs_os = qs_os.filter(oficina=oficina)

        # Hoje (na timezone configurada)
        hoje = timezone.localdate()

        # ✅ Seu model tem campo "aberta" (BooleanField), não "status"
        os_abertas = qs_os.filter(aberta=True).count()

        # ✅ Seu model tem "data_entrada" (parece ser DateField)
        # Se for DateTimeField, poderíamos usar data_entrada__date=hoje
        checkins_hoje = qs_os.filter(data_entrada=hoje).count()

        # Etapas que aparecem no dashboard
        qs_etapas = Etapa.objects.filter(mostrar_no_dashboard=True)
        if oficina is not None:
            qs_etapas = qs_etapas.filter(oficina=oficina)

        etapas_cards = []
        for etapa in qs_etapas:
            total_os_etapa = qs_os.filter(
                etapa_atual=etapa,
                aberta=True,      # só OS ainda abertas na etapa
            ).count()

            etapas_cards.append(
                {
                    "id": etapa.id,
                    "nome": etapa.nome,
                    "total_os": total_os_etapa,
                }
            )

        data = {
            "os_abertas": os_abertas,
            "checkins_hoje": checkins_hoje,
            "etapas": etapas_cards,
        }

        return Response(data)


class OficinaDriveStatusView(APIView):
    """
    Retorna o status da integração de Google Drive para a oficina do usuário logado.
    Usado pelo painel para mostrar se está conectado ou não.

    IMPORTANTE: não devolve 400 só porque não tem oficina ou oficina_id.
    Nesses casos, devolve has_drive=False para o front tratar normalmente.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        oficina = get_oficina_do_usuario(user)

        # Se for superuser e não tiver oficina em get_oficina_do_usuario,
        # tenta pegar ?oficina_id=, mas se não vier, apenas mostra "sem drive".
        if user.is_superuser and oficina is None:
            oficina_id = request.query_params.get("oficina_id")
            if oficina_id:
                try:
                    oficina = Oficina.objects.get(id=oficina_id)
                except Oficina.DoesNotExist:
                    # oficina_id inválida -> considera sem integração
                    oficina = None

        # Se ainda assim não tiver oficina, considera "sem integração", mas 200 OK
        if oficina is None:
            return Response(
                {
                    "has_drive": False,
                    "ativo": False,
                    "root_folder_id": None,
                    "detail": "Nenhuma oficina associada ao usuário para consultar o Drive.",
                },
                status=status.HTTP_200_OK,
            )

        # Tenta buscar config de Drive
        try:
            config = oficina.drive_config
            data = {
                "has_drive": True,
                "ativo": config.ativo,
                "root_folder_id": config.root_folder_id,
            }
        except OficinaDriveConfig.DoesNotExist:
            data = {
                "has_drive": False,
                "ativo": False,
                "root_folder_id": None,
            }

        return Response(data)


class GoogleDriveAuthURLView(APIView):
    """
    Devolve a URL de autorização do Google para o Drive da oficina do usuário.
    O front chama esse endpoint e faz window.location = authorization_url.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        oficina = get_oficina_do_usuario(user)

        print("=== USUÁRIO LOGADO ===")
        print("ID:", request.user.id)
        print("Email:", request.user.email)
        print("Superuser:", request.user.is_superuser)
        print("Staff:", request.user.is_staff)
        print("======================")

        if oficina is None and not user.is_superuser:
            return Response(
                {"detail": "Usuário não está associado a nenhuma oficina."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Para superuser, permite escolher a oficina via query param
        if user.is_superuser and oficina is None:
            oficina_id = request.query_params.get("oficina_id")
            if not oficina_id:
                return Response(
                    {"detail": "Informe oficina_id para gerar a URL (superusuário)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                oficina = Oficina.objects.get(id=oficina_id)
            except Oficina.DoesNotExist:
                return Response(
                    {"detail": "Oficina não encontrada."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        flow = Flow.from_client_secrets_file(
            settings.GOOGLE_DRIVE_CLIENT_SECRETS_FILE,
            scopes=settings.GOOGLE_DRIVE_SCOPES,
            redirect_uri=settings.GOOGLE_DRIVE_REDIRECT_URI,
        )

        # Colocamos o ID da oficina no state (MVP, depois dá pra assinar esse valor)
        state = f"oficina:{oficina.id}"

        authorization_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )

        return Response({"authorization_url": authorization_url})

class GoogleDriveOAuth2CallbackView(APIView):
    """
    Endpoint de callback do OAuth2 do Google.
    - Troca o "code" por tokens
    - Cria/atualiza OficinaDriveConfig
    - Cria a pasta raiz da oficina no Drive (se ainda não existir)
    - Redireciona de volta para o painel
    """
    # Google não manda cookie de auth; aqui não exigimos auth
    permission_classes = []
    authentication_classes = []

    def get(self, request):
        error = request.GET.get("error")
        if error:
            # Erro vindo do Google (usuário cancelou, etc.)
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracao_drive/')}"
                f"?status=error&msg={error}"
            )

        code = request.GET.get("code")
        state = request.GET.get("state", "")

        if not code or not state:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracao_drive/')}"
                "?status=error&msg=missing_code_or_state"
            )

        # Extrai oficina_id do state ("oficina:123")
        oficina_id = None
        if state.startswith("oficina:"):
            oficina_id = state.split(":", 1)[1]

        if not oficina_id:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracao_drive/')}"
                "?status=error&msg=invalid_state"
            )

        try:
            oficina = Oficina.objects.get(id=oficina_id)
        except Oficina.DoesNotExist:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracao_drive/')}"
                "?status=error&msg=oficina_not_found"
            )

        # Refaz o flow para buscar o token
        flow = Flow.from_client_secrets_file(
            settings.GOOGLE_DRIVE_CLIENT_SECRETS_FILE,
            scopes=settings.GOOGLE_DRIVE_SCOPES,
            redirect_uri=settings.GOOGLE_DRIVE_REDIRECT_URI,
        )

        try:
            flow.fetch_token(code=code)
        except Exception:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracao_drive/')}"
                "?status=error&msg=token_fetch_failed"
            )

        creds = flow.credentials

        # Monta o JSON que usaremos depois no drive_service.py
        cred_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        }

        cred_json = json.dumps(cred_data)

        # Cria ou atualiza a config
        config, created = OficinaDriveConfig.objects.get_or_create(
            oficina=oficina,
            defaults={
                "credentials_json": cred_json,
                "root_folder_id": "",
                "ativo": True,
            },
        )

        if not created:
            config.credentials_json = cred_json
            config.ativo = True

        # Cria pasta raiz se ainda não existir
        if not config.root_folder_id:
            from googleapiclient.discovery import build

            service = build("drive", "v3", credentials=creds)

            folder_metadata = {
                "name": f"CheckAuto - {oficina.nome}",
                "mimeType": "application/vnd.google-apps.folder",
            }

            try:
                folder = service.files().create(
                    body=folder_metadata,
                    fields="id",
                ).execute()
                config.root_folder_id = folder.get("id")
            except Exception:
                # Se der erro, mantemos root_folder_id vazio
                pass

        config.save()

        redirect_url = getattr(
            settings,
            "GOOGLE_DRIVE_POST_CONNECT_REDIRECT",
            "/painel/integracao_drive/",
        )

        return redirect(f"{redirect_url}?status=ok")

# core/views.py
from django.shortcuts import render


def integracao_drive_view(request):
    return render(request, "integracao_drive.html")

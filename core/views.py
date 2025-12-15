from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
import base64
from django.core.files.base import ContentFile
from datetime import date
from django.db.models import Q
from .drive_service import criar_pasta_os, upload_foto_para_drive  # <-- novo
from django.conf import settings
from django.shortcuts import redirect
from google_auth_oauthlib.flow import Flow
import json
from .models import OficinaDriveConfig
from .models import Oficina, UsuarioOficina, Etapa, ConfigFoto, OS, FotoOS, OficinaDriveConfig
from .utils import get_oficina_do_usuario
from core.drive_service import upload_foto_os_drive
from core.drive_service import upload_foto_os_drive


from django.utils import timezone
from .models import Oficina, UsuarioOficina, Etapa, ConfigFoto, OS, FotoOS
from .serializers import (
    OficinaSerializer,
    UsuarioOficinaSerializer,
    EtapaSerializer,
    ConfigFotoSerializer,
    OSSerializer,
    FotoOSSerializer,
)
from .utils import get_oficina_do_usuario

import logging
from .drive_service import criar_pasta_os, upload_foto_para_drive
logger = logging.getLogger(__name__)


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
    permission_classes = [IsAuthenticated]

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
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if user.is_superuser:
            return Etapa.objects.select_related('oficina').all()

        oficina = get_oficina_do_usuario(user)
        if oficina is None:
            return Etapa.objects.none()

        return Etapa.objects.select_related('oficina').filter(oficina=oficina)

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


from rest_framework import serializers  # garantir que está importado

class ConfigFotoViewSet(viewsets.ModelViewSet):
    queryset = ConfigFoto.objects.select_related('oficina', 'etapa').all()
    serializer_class = ConfigFotoSerializer
    permission_classes = [IsAuthenticated]

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
    queryset = OS.objects.select_related('oficina', 'etapa_atual').all()
    serializer_class = OSSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Lista de OS filtrada pela oficina do usuário e pelos parâmetros da consulta:
        - search: código, placa ou nome do cliente
        - status: 'aberta' ou 'fechada'
        - etapa: id da etapa_atual
        """
        user = self.request.user

        # Base: filtra por oficina
        if user.is_superuser:
            qs = OS.objects.select_related('oficina', 'etapa_atual').all()
        else:
            oficina = get_oficina_do_usuario(user)
            if oficina is None:
                return OS.objects.none()

            qs = OS.objects.select_related('oficina', 'etapa_atual').filter(oficina=oficina)

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

        if oficina is None and not user.is_superuser:
            # Se por algum motivo o usuário não tiver oficina associada
            raise serializers.ValidationError({"oficina": "Oficina não encontrada para o usuário."})

        os_obj = serializer.save(oficina=oficina)

        # Tenta criar a pasta da OS no Drive
        try:
            logger.info("Chamando criar_pasta_os para OS id=%s codigo=%s", os_obj.id, os_obj.codigo)
            criar_pasta_os(os_obj)
        except Exception:
            logger.exception("Erro ao criar pasta no Drive para OS id=%s", os_obj.id)




class FotoOSViewSet(viewsets.ModelViewSet):
    queryset = FotoOS.objects.select_related('os', 'etapa', 'config_foto', 'tirada_por').all()
    serializer_class = FotoOSSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

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
            drive_file_id = upload_foto_os_drive(
                os_obj=foto.os,
                etapa=foto.etapa,
                caminho_arquivo_local=foto.arquivo.path,
                nome_arquivo=foto.arquivo.name,
            )
            foto.drive_file_id = drive_file_id
            foto.save(update_fields=["drive_file_id"])
        except Exception:
            logger.exception("Erro ao enviar foto id=%s para o Drive", foto.id)


from django.utils import timezone
import base64
from django.core.files.base import ContentFile

from .models import Etapa, UsuarioOficina, Oficina  # garante esses imports


class SyncView(APIView):
    """
    Endpoint especial para sincronização em lote das OS criadas offline no PWA.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        oficina = get_oficina_do_usuario(user)

        # Se NÃO achou oficina pelo vínculo e o usuário for superuser,
        # usamos a primeira oficina (para ambiente de desenvolvimento / MVP).
        if oficina is None and user.is_superuser:
            oficina = Oficina.objects.first()

        # Se ainda assim não tiver oficina, aí sim é erro.
        if oficina is None:
            return Response(
                {"detail": "Usuário não está vinculado a nenhuma oficina ativa e nenhuma oficina padrão foi encontrada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dados = request.data
        lista_os = dados.get("osPendentes", [])

        resultados = []

        for item in lista_os:
            # ID local do PWA não serve para o backend
            item.pop("id", None)

            # força SEMPRE a oficina do usuário logado
            item["oficina"] = oficina.id

            # converte para o formato do serializer de OS
            item_convertido = self.converter_payload_pwa(item)

            serializer = OSSerializer(
                data=item_convertido,
                context={"request": request},
            )

            if serializer.is_valid():
                os_obj = serializer.save()

                # 1) Garante a pasta da OS no Drive durante o sync
                try:
                    criar_pasta_os(os_obj)
                except Exception as e:
                    # não quebra o sync se o Drive falhar
                    print(f"[SYNC] Erro ao criar pasta da OS {os_obj.id} no Drive: {e}")

                # 2) Salva fotos (padrão + livres) como FotoOS tipo LIVRE
                self.salvar_fotos(os_obj, item, user)

                # re-serializa com o objeto salvo (só pra garantir consistência)
                resultados.append(OSSerializer(os_obj, context={"request": request}).data)
            else:
                resultados.append({
                    "input": item,
                    "errors": serializer.errors,
                })

        return Response({"os": resultados}, status=status.HTTP_200_OK)

    def converter_payload_pwa(self, item):
        """
        Transforma a OS recebida do PWA no formato que o model/serializer OS espera.
        """
        veiculo = item.get("veiculo", {}) or {}
        os_data = item.get("os", {}) or {}
        cliente = item.get("cliente", {}) or {}

        # Código da OS:
        numero_interno = os_data.get("numeroInterno") or veiculo.get("placa")
        if not numero_interno:
            numero_interno = f"PWA-{timezone.now().strftime('%Y%m%d%H%M%S')}"

        return {
            "oficina": item.get("oficina"),
            "codigo": numero_interno,
            "placa": veiculo.get("placa"),
            "modelo_veiculo": veiculo.get("modelo"),
            "cor_veiculo": veiculo.get("cor"),
            "nome_cliente": cliente.get("nome"),
            "telefone_cliente": cliente.get("telefone"),
            "observacoes": os_data.get("observacoes"),
            # por enquanto NÃO setamos etapa_atual (evita erro de tipo)
            "etapa_atual": None,
            "data_entrada": timezone.now(),
            "aberta": True,
        }

    def salvar_fotos(self, os_obj, item, user):
        """
        Salva fotos padrão e livres enviadas como base64 pelo PWA.

        Neste momento, todas as fotos são salvas como:
        - tipo = 'LIVRE'
        - etapa = etapa de check-in da oficina (ou etapa_atual da OS)
        - sem config_foto (regra de negócio das fotos LIVRES).
        """
        fotos = item.get("fotos", {}) or {}
        todas_fotos = []
        todas_fotos.extend(fotos.get("padrao", []) or [])
        todas_fotos.extend(fotos.get("livres", []) or [])

        if not todas_fotos:
            return

        # Descobre etapa para associar as fotos
        etapa = os_obj.etapa_atual
        if etapa is None:
            etapa = Etapa.objects.filter(
                oficina=os_obj.oficina,
                is_checkin=True
            ).first()

        if etapa is None:
            # sem etapa válida, melhor não criar fotos
            return

        # Descobre o UsuarioOficina (se existir) para preencher tirada_por
        usuario_oficina = None
        try:
            usuario_oficina = UsuarioOficina.objects.get(
                user=user,
                oficina=os_obj.oficina,
                ativo=True,
            )
        except UsuarioOficina.DoesNotExist:
            usuario_oficina = None

        for foto in todas_fotos:
            conteudo_base64 = foto.get("arquivo")
            if not conteudo_base64:
                continue

            # Remove prefixo "data:image/jpeg;base64,..." se vier
            if "," in conteudo_base64:
                conteudo_base64 = conteudo_base64.split(",", 1)[1]

            try:
                conteudo = base64.b64decode(conteudo_base64)
            except Exception:
                continue

            extensao = foto.get("extensao") or "jpg"

            arquivo = ContentFile(
                conteudo,
                name=f"pwa_os{os_obj.id}_{foto.get('id') or '0'}.{extensao}"
            )

            foto_obj = FotoOS.objects.create(
                os=os_obj,
                etapa=etapa,
                tipo="LIVRE",
                config_foto=None,
                arquivo=arquivo,
                titulo=foto.get("nome") or None,
                tirada_por=usuario_oficina,
            )

            # Envia essa foto para o Drive (na pasta da OS + subpasta da etapa)
            try:
                upload_foto_para_drive(foto_obj)
            except Exception as e:
                print(f"[SYNC] Erro ao enviar foto {foto_obj.id} para o Drive: {e}")


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
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracoes/drive/')}"
                f"?status=error&msg={error}"
            )

        code = request.GET.get("code")
        state = request.GET.get("state", "")

        if not code or not state:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracoes/drive/')}"
                "?status=error&msg=missing_code_or_state"
            )

        # Extrai oficina_id do state ("oficina:123")
        oficina_id = None
        if state.startswith("oficina:"):
            oficina_id = state.split(":", 1)[1]

        if not oficina_id:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracoes/drive/')}"
                "?status=error&msg=invalid_state"
            )

        try:
            oficina = Oficina.objects.get(id=oficina_id)
        except Oficina.DoesNotExist:
            return redirect(
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracoes/drive/')}"
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
                f"{getattr(settings, 'GOOGLE_DRIVE_POST_CONNECT_REDIRECT', '/painel/integracoes/drive/')}"
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
            "/painel/integracoes/drive/",
        )

        return redirect(f"{redirect_url}?status=ok")

# core/views.py
from django.shortcuts import render
from django.contrib.auth.decorators import login_required

@login_required
def integracao_drive_view(request):
    return render(request, "integracao_drive.html")

import base64
import shutil
import tempfile
from unittest import mock

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from core.models import ConfigFoto, Oficina, UsuarioOficina, Etapa, FotoOS, OS


class SyncViewTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp()
        cls._override_media = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override_media.enable()

    @classmethod
    def tearDownClass(cls):
        cls._override_media.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user(username="user", password="pass")
        self.oficina = Oficina.objects.create(nome="Oficina Teste")
        self.usuario_oficina = UsuarioOficina.objects.create(
            user=self.user,
            oficina=self.oficina,
            papel="GERENTE",
            ativo=True,
        )
        self.etapa = Etapa.objects.create(
            oficina=self.oficina,
            nome="Check-in",
            ordem=1,
            is_checkin=True,
        )

        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse("sync")

    def _build_payload(self, numero_interno="001", fotos=None):
        return {
            "osPendentes": [
                {
                    "os": {"numeroInterno": numero_interno},
                    "veiculo": {"placa": "ABC1D23", "modelo": "Modelo"},
                    "cliente": {"nome": "Cliente"},
                    "fotos": fotos or {"padrao": [], "livres": []},
                }
            ]
        }

    def test_sync_cria_os_sem_fotos(self):
        payload = self._build_payload(numero_interno="100")

        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            OS.objects.filter(oficina=self.oficina, codigo="100").exists()
        )
        self.assertEqual(FotoOS.objects.count(), 0)

    def test_sync_cria_foto_com_base64_valido(self):
        conteudo = base64.b64encode(b"foto-conteudo").decode()
        fotos = {
            "padrao": [],
            "livres": [
                {
                    "arquivo": f"data:image/png;base64,{conteudo}",
                    "extensao": "png",
                }
            ],
        }
        payload = self._build_payload(numero_interno="200", fotos=fotos)

        with mock.patch("core.views.criar_pasta_os"), mock.patch(
            "core.views.upload_foto_para_drive"
        ):
            response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(OS.objects.filter(codigo="200").count(), 1)
        self.assertEqual(FotoOS.objects.count(), 1)
        self.assertEqual(response.data["os"][0]["photo_errors"], [])

    def test_sync_base64_invalido_registra_photo_errors(self):
        fotos = {
            "livres": [
                {
                    "arquivo": "nao-e-base64",
                    "extensao": "png",
                }
            ]
        }
        payload = self._build_payload(numero_interno="300", fotos=fotos)

        with mock.patch("core.views.criar_pasta_os"), mock.patch(
            "core.views.upload_foto_para_drive"
        ):
            response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(OS.objects.filter(codigo="300").count(), 1)
        self.assertEqual(FotoOS.objects.count(), 0)

        photo_errors = response.data["os"][0]["photo_errors"]
        self.assertTrue(photo_errors)

    def test_sync_cria_foto_padrao_quando_config_foto_presente(self):
        config = ConfigFoto.objects.create(
            oficina=self.oficina,
            etapa=self.etapa,
            nome="Frente do carro",
        )
        conteudo = base64.b64encode(b"foto-conteudo").decode()
        fotos = {
            "padrao": [
                {
                    "arquivo": f"data:image/png;base64,{conteudo}",
                    "extensao": "png",
                    "config_foto_id": config.id,
                }
            ]
        }
        payload = self._build_payload(numero_interno="400", fotos=fotos)

        with mock.patch("core.views.criar_pasta_os"), mock.patch(
            "core.views.upload_foto_para_drive"
        ):
            response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(FotoOS.objects.count(), 1)
        foto = FotoOS.objects.first()
        self.assertEqual(foto.tipo, "PADRAO")
        self.assertEqual(foto.config_foto, config)
        self.assertEqual(response.data["os"][0]["photo_errors"], [])

    def test_sync_foto_padrao_sem_config_foto_gera_erro(self):
        conteudo = base64.b64encode(b"foto-conteudo").decode()
        fotos = {
            "padrao": [
                {
                    "arquivo": f"data:image/png;base64,{conteudo}",
                    "extensao": "png",
                    "config_foto_id": 9999,
                }
            ]
        }
        payload = self._build_payload(numero_interno="500", fotos=fotos)

        with mock.patch("core.views.criar_pasta_os"), mock.patch(
            "core.views.upload_foto_para_drive"
        ):
            response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(FotoOS.objects.count(), 0)
        photo_errors = response.data["os"][0]["photo_errors"]
        self.assertTrue(photo_errors)


class AvancarEtapaTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp()
        cls._override_media = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override_media.enable()

    @classmethod
    def tearDownClass(cls):
        cls._override_media.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user(username="user2", password="pass")
        self.oficina = Oficina.objects.create(nome="Oficina Avanço")
        self.usuario_oficina = UsuarioOficina.objects.create(
            user=self.user,
            oficina=self.oficina,
            papel="GERENTE",
            ativo=True,
        )

        self.etapa_atual = Etapa.objects.create(
            oficina=self.oficina,
            nome="Check-in",
            ordem=1,
            is_checkin=True,
            ativa=True,
        )
        self.proxima_etapa = Etapa.objects.create(
            oficina=self.oficina,
            nome="Funilaria",
            ordem=2,
            ativa=True,
        )
        self.config = ConfigFoto.objects.create(
            oficina=self.oficina,
            etapa=self.etapa_atual,
            nome="Frente",
            obrigatoria=True,
        )

        self.os = OS.objects.create(
            oficina=self.oficina,
            codigo="OS-1",
            etapa_atual=self.etapa_atual,
        )

        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse("os-avancar-etapa", args=[self.os.id])

    def _criar_foto_obrigatoria(self):
        return FotoOS.objects.create(
            os=self.os,
            etapa=self.etapa_atual,
            tipo="PADRAO",
            config_foto=self.config,
            arquivo=SimpleUploadedFile("foto.jpg", b"dados", content_type="image/jpeg"),
        )

    def test_nao_avanca_sem_fotos_obrigatorias(self):
        response = self.client.post(self.url, {})

        self.assertEqual(response.status_code, 400)
        self.os.refresh_from_db()
        self.assertEqual(self.os.etapa_atual, self.etapa_atual)
        self.assertIn(self.config.id, response.data.get("configs_pendentes", []))

    def test_avanca_para_proxima_etapa_quando_tudo_ok(self):
        self._criar_foto_obrigatoria()

        response = self.client.post(self.url, {"observacao": "Tudo certo"})

        self.assertEqual(response.status_code, 200)
        self.os.refresh_from_db()
        self.assertEqual(self.os.etapa_atual, self.proxima_etapa)
        self.assertIn("Tudo certo", self.os.observacoes)

    def test_multi_tenant_bloqueia_os_de_outra_oficina(self):
        outra_oficina = Oficina.objects.create(nome="Outra")
        outra_etapa = Etapa.objects.create(oficina=outra_oficina, nome="E1", ordem=1, ativa=True)
        outra_os = OS.objects.create(oficina=outra_oficina, codigo="OS-2", etapa_atual=outra_etapa)

        url = reverse("os-avancar-etapa", args=[outra_os.id])
        response = self.client.post(url, {})

        self.assertEqual(response.status_code, 404)

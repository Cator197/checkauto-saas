import base64
import shutil
import tempfile
from unittest import mock

from django.contrib.auth.models import User
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from core.models import Oficina, UsuarioOficina, Etapa, FotoOS, OS


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

import base64
import uuid
import imghdr
from django.core.files.base import ContentFile
from rest_framework import serializers
from .models import Oficina, UsuarioOficina, Etapa, ConfigFoto, OS, FotoOS


class OficinaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Oficina
        fields = [
            'id',
            'nome',
            'cnpj',
            'telefone',
            'email',
            'endereco',
            'ativa',
            'criado_em',
            'atualizado_em',
        ]


class UsuarioOficinaSerializer(serializers.ModelSerializer):
    user_nome = serializers.CharField(source='user.get_full_name', read_only=True)
    user_username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = UsuarioOficina
        fields = [
            'id',
            'user',
            'user_nome',
            'user_username',
            'oficina',
            'papel',
            'ativo',
            'criado_em',
        ]


class EtapaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Etapa
        fields = [
            'id',
            'oficina',
            'nome',
            'ordem',
            'mostrar_no_dashboard',
            'is_checkin',
            'ativa',
            'criado_em',
            'atualizado_em',
        ]
        extra_kwargs = {
            'oficina': {'read_only': True},
        }


class ConfigFotoSerializer(serializers.ModelSerializer):
    etapa_nome = serializers.CharField(source='etapa.nome', read_only=True)

    class Meta:
        model = ConfigFoto
        fields = [
            'id',
            'oficina',
            'etapa',
            'etapa_nome',
            'nome',
            'descricao',
            'obrigatoria',
            'ordem',
            'ativa',
            'criado_em',
            'atualizado_em',
        ]
        extra_kwargs = {
            'oficina': {'read_only': True},
        }

class OSSerializer(serializers.ModelSerializer):
    oficina_nome = serializers.CharField(source='oficina.nome', read_only=True)
    etapa_atual_nome = serializers.CharField(source='etapa_atual.nome', read_only=True, default=None)

    class Meta:
        model = OS
        fields = [
            'id',
            'oficina',
            'oficina_nome',
            'codigo',
            'placa',
            'modelo_veiculo',
            'cor_veiculo',
            'nome_cliente',
            'telefone_cliente',
            'etapa_atual',
            'etapa_atual_nome',
            'observacoes',
            'data_entrada',
            'data_prevista_entrega',
            'data_saida',
            'aberta',
            'drive_folder_id',
            'fotos',
        ]

        extra_kwargs = {
            # A oficina sempre vem do usuário logado (painel, PWA e sync)
            'oficina': {'read_only': True},
            # Relação reversa; leitura somente evita exigir o campo no payload
            'fotos': {'read_only': True},
        }



class FotoOSSerializer(serializers.ModelSerializer):
    os_codigo = serializers.CharField(source='os.codigo', read_only=True)
    oficina = serializers.SerializerMethodField()
    etapa_nome = serializers.CharField(source='etapa.nome', read_only=True)

    config_foto_nome = serializers.CharField(source='config_foto.nome', read_only=True, default=None)
    tirada_por_nome = serializers.CharField(
        source='tirada_por.user.get_full_name',
        read_only=True,
        default=None
    )

    class Meta:
        model = FotoOS
        fields = [
            'id',
            'os',
            'os_codigo',
            'oficina',
            'etapa',
            'etapa_nome',
            'tipo',
            'config_foto',
            'config_foto_nome',
            'arquivo',
            'drive_file_id',  # <-- adicionar aqui
            'titulo',
            'observacao',
            'tirada_por',
            'tirada_por_nome',
            'tirada_em',
        ]

    def get_oficina(self, obj):
        return obj.os.oficina_id

    def validate_arquivo(self, value):
        """
        Aceita upload multipart (UploadedFile) e também strings base64 (data URL)
        enviadas pelo PWA. Converte a string em ContentFile para que o FileField
        possa salvar normalmente.
        """
        if not isinstance(value, str):
            return value

        conteudo_base64 = value
        header = None

        if value.startswith("data:") and "," in value:
            header, conteudo_base64 = value.split(",", 1)
        elif "," in value:
            conteudo_base64 = value.split(",", 1)[1]

        try:
            conteudo = base64.b64decode(conteudo_base64)
        except Exception:
            raise serializers.ValidationError("Arquivo base64 inválido.")

        extensao = None
        if header:
            if "image/png" in header:
                extensao = "png"
            elif "image/webp" in header:
                extensao = "webp"
            elif "image/jpeg" in header or "image/jpg" in header:
                extensao = "jpg"

        if not extensao:
            extensao = imghdr.what(None, h=conteudo) or "jpg"

        nome_arquivo = f"foto_{uuid.uuid4().hex}.{extensao}"
        return ContentFile(conteudo, name=nome_arquivo)

    def validate(self, attrs):
        tipo = attrs.get('tipo')
        config_foto = attrs.get('config_foto')
        etapa = attrs.get('etapa')
        os_obj = attrs.get('os')

        # Regras de negócio espelhadas do model.clean para validar antes de salvar
        if not os_obj:
            raise serializers.ValidationError({'os': 'OS é obrigatória.'})

        if not etapa:
            raise serializers.ValidationError({'etapa': 'Etapa é obrigatória.'})

        if tipo == 'PADRAO':
            if not config_foto:
                raise serializers.ValidationError({'config_foto': 'Fotos PADRÃO precisam de config_foto.'})
            if config_foto.oficina_id != os_obj.oficina_id:
                raise serializers.ValidationError({'config_foto': 'ConfigFoto deve ser da mesma oficina da OS.'})
            if config_foto.etapa_id != etapa.id:
                raise serializers.ValidationError({'etapa': 'Etapa da foto deve ser a mesma da ConfigFoto.'})
        elif tipo == 'LIVRE':
            if config_foto is not None:
                raise serializers.ValidationError({'config_foto': 'Fotos LIVRES não podem ter config_foto.'})
        else:
            raise serializers.ValidationError({'tipo': 'Tipo de foto inválido.'})

        return attrs

import base64
import uuid
import imghdr
from django.core.files.base import ContentFile
from rest_framework import serializers
from .models import (
    Oficina,
    UsuarioOficina,
    Etapa,
    ConfigFoto,
    OS,
    FotoOS,
    ObservacaoEtapaOS,
)


DATETIME_INPUT_FORMATS = [
    "%Y-%m-%d",
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%f%z",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
]


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


class ObservacaoEtapaOSSerializer(serializers.ModelSerializer):
    etapa_nome = serializers.CharField(source='etapa.nome', read_only=True)
    criado_por_nome = serializers.CharField(
        source='criado_por.user.get_full_name', read_only=True, default=None
    )

    class Meta:
        model = ObservacaoEtapaOS
        fields = [
            'id',
            'os',
            'etapa',
            'etapa_nome',
            'texto',
            'criado_por',
            'criado_por_nome',
            'criado_em',
            'atualizado_em',
        ]
        read_only_fields = ('os', 'etapa', 'criado_por', 'criado_em', 'atualizado_em')


class OSSerializer(serializers.ModelSerializer):
    oficina_nome = serializers.CharField(source='oficina.nome', read_only=True)
    etapa_atual_nome = serializers.CharField(source='etapa_atual.nome', read_only=True, default=None)
    observacoes_etapas = serializers.SerializerMethodField()
    observacao_etapa_atual = serializers.SerializerMethodField()
    data_entrada = serializers.DateTimeField(
        required=False, allow_null=True, input_formats=DATETIME_INPUT_FORMATS
    )
    data_prevista_entrega = serializers.DateTimeField(
        required=False, allow_null=True, input_formats=DATETIME_INPUT_FORMATS
    )
    data_saida = serializers.DateTimeField(
        required=False, allow_null=True, input_formats=DATETIME_INPUT_FORMATS
    )

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
            'observacoes_etapas',
            'observacao_etapa_atual',
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
            'modelo_veiculo': {
                'required': True,
                'allow_blank': False,
                'error_messages': {
                    'required': 'Modelo do veículo não pode ser vazio',
                    'blank': 'Modelo do veículo não pode ser vazio',
                },
            },
        }

    def get_observacoes_etapas(self, obj):
        qs = getattr(obj, 'observacoes_etapas', None)
        if qs is None:
            return []

        itens = qs.all() if hasattr(qs, 'all') else qs

        return ObservacaoEtapaOSSerializer(
            itens, many=True, context=self.context
        ).data

    def get_observacao_etapa_atual(self, obj):
        if not obj.etapa_atual_id:
            return None

        qs = getattr(obj, 'observacoes_etapas', None) or []
        itens = qs.all() if hasattr(qs, 'all') else qs

        obs = next((item for item in itens if item.etapa_id == obj.etapa_atual_id), None)

        return obs.texto if obs else None


class PwaEtapaAtualSerializer(serializers.Serializer):
    id = serializers.IntegerField(allow_null=True)
    nome = serializers.CharField(allow_null=True, allow_blank=True)


class PwaVeiculoEmProducaoSerializer(serializers.Serializer):
    os_id = serializers.IntegerField()
    codigo = serializers.CharField()
    placa = serializers.CharField(allow_null=True, required=False)
    modelo_veiculo = serializers.CharField(allow_null=True, required=False)
    etapa_atual = PwaEtapaAtualSerializer(allow_null=True)
    faltam_fotos_obrigatorias = serializers.IntegerField()
    thumb_url = serializers.CharField(allow_null=True, required=False)


class FotoOSSerializer(serializers.ModelSerializer):
    os_codigo = serializers.CharField(source='os.codigo', read_only=True)
    oficina = serializers.SerializerMethodField()
    etapa_nome = serializers.CharField(source='etapa.nome', read_only=True)
    drive_thumb_url = serializers.SerializerMethodField()
    drive_url = serializers.SerializerMethodField()

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
            'drive_thumb_url',
            'drive_url',
            'titulo',
            'observacao',
            'tirada_por',
            'tirada_por_nome',
            'tirada_em',
        ]
        # FotoOS não possui campo "fotos"; manter apenas campos reais do model.
        extra_kwargs = {
            # Permitem que o viewset injete defaults quando o frontend não envia
            'etapa': {'required': False},
            'tipo': {'required': False},
        }

    def get_oficina(self, obj):
        return obj.os.oficina_id

    def get_drive_thumb_url(self, obj):
        if not obj.drive_file_id:
            return None
        return f"https://drive.google.com/thumbnail?id={obj.drive_file_id}&sz=w800"

    def get_drive_url(self, obj):
        if not obj.drive_file_id:
            return None
        return f"https://drive.google.com/uc?id={obj.drive_file_id}"

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
        tipo = attrs.get('tipo') or 'LIVRE'
        config_foto = attrs.get('config_foto')
        etapa = attrs.get('etapa')
        os_obj = attrs.get('os')

        # Garante defaults quando o payload não envia estes campos
        if etapa is None and os_obj:
            etapa = Etapa.objects.filter(oficina=os_obj.oficina, is_checkin=True).first()
            if etapa:
                attrs['etapa'] = etapa
        attrs['tipo'] = tipo

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

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
            'fotos',
        ]

    def get_oficina(self, obj):
        return obj.os.oficina_id

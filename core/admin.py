from django.contrib import admin
from .models import Oficina, UsuarioOficina, Etapa, ConfigFoto, OS, FotoOS, OficinaDriveConfig



@admin.register(Oficina)
class OficinaAdmin(admin.ModelAdmin):
    list_display = ('nome', 'cnpj', 'telefone', 'ativa', 'criado_em')
    search_fields = ('nome', 'cnpj')
    list_filter = ('ativa',)



@admin.register(UsuarioOficina)
class UsuarioOficinaAdmin(admin.ModelAdmin):
    list_display = ('user', 'oficina', 'papel', 'ativo', 'criado_em')
    list_filter = ('papel', 'ativo', 'oficina')
    search_fields = ('user__username', 'user__first_name', 'user__last_name', 'oficina__nome')


@admin.register(Etapa)
class EtapaAdmin(admin.ModelAdmin):
    list_display = ('nome', 'oficina', 'ordem', 'is_checkin', 'mostrar_no_dashboard', 'ativa')
    list_filter = ('oficina', 'is_checkin', 'mostrar_no_dashboard', 'ativa')
    ordering = ('oficina', 'ordem')
    search_fields = ('nome', 'oficina__nome')


@admin.register(ConfigFoto)
class ConfigFotoAdmin(admin.ModelAdmin):
    list_display = ('nome', 'oficina', 'etapa', 'obrigatoria', 'ordem', 'ativa')
    list_filter = ('oficina', 'etapa', 'obrigatoria', 'ativa')
    ordering = ('oficina', 'etapa', 'ordem')
    search_fields = ('nome', 'oficina__nome', 'etapa__nome')

@admin.register(OS)
class OSAdmin(admin.ModelAdmin):
    list_display = (
        'codigo',
        'oficina',
        'placa',
        'nome_cliente',
        'etapa_atual',
        'aberta',
        'data_entrada',
        'data_prevista_entrega',
        'data_saida',
    )
    list_filter = ('oficina', 'aberta', 'etapa_atual')
    search_fields = ('codigo', 'placa', 'nome_cliente', 'telefone_cliente')
    autocomplete_fields = ('oficina', 'etapa_atual')
    date_hierarchy = 'data_entrada'


@admin.register(FotoOS)
class FotoOSAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'os',
        'oficina',
        'etapa',
        'tipo',
        'config_foto',
        'tirada_por',
        'tirada_em',
    )
    list_filter = ('tipo', 'etapa', 'os__oficina')
    search_fields = ('os__codigo', 'os__placa', 'titulo')
    autocomplete_fields = ('os', 'etapa', 'config_foto', 'tirada_por')

    def oficina(self, obj):
        return obj.os.oficina
    oficina.short_description = "Oficina"

@admin.register(OficinaDriveConfig)
class OficinaDriveConfigAdmin(admin.ModelAdmin):
    list_display = ("oficina", "ativo", "root_folder_id", "atualizado_em")
    search_fields = ("oficina__nome", "root_folder_id")
    list_filter = ("ativo",)
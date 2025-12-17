from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError


class Oficina(models.Model):
    nome = models.CharField(max_length=255)
    cnpj = models.CharField(max_length=18, blank=True, null=True)
    telefone = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    endereco = models.CharField(max_length=255, blank=True, null=True)

    ativa = models.BooleanField(default=True)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Oficina"
        verbose_name_plural = "Oficinas"

    def __str__(self):
        return self.nome


class UsuarioOficina(models.Model):
    ROLE_CHOICES = (
        ('ADMIN', 'Administrador'),
        ('GERENTE', 'Gerente'),
        ('FUNC', 'Funcionário'),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='usuarios_oficina')
    oficina = models.ForeignKey(Oficina, on_delete=models.CASCADE, related_name='usuarios')
    papel = models.CharField(max_length=10, choices=ROLE_CHOICES, default='FUNC')
    ativo = models.BooleanField(default=True)

    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Usuário da oficina"
        verbose_name_plural = "Usuários da oficina"
        unique_together = ('user', 'oficina')

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} - {self.oficina.nome}"


class Etapa(models.Model):
    """
    Define as etapas do processo da oficina.
    Ex.: Check-in, Funilaria, Pintura, Preparação, Entrega.
    """
    oficina = models.ForeignKey(Oficina, on_delete=models.CASCADE, related_name='etapas')
    nome = models.CharField(max_length=100)
    ordem = models.PositiveIntegerField(help_text="Ordem em que a etapa aparece no fluxo.")
    mostrar_no_dashboard = models.BooleanField(
        default=True,
        help_text="Define se essa etapa aparecerá nos cards do dashboard."
    )
    is_checkin = models.BooleanField(
        default=False,
        help_text="Marque apenas na etapa que representa o CHECK-IN."
    )
    ativa = models.BooleanField(default=True)

    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Etapa"
        verbose_name_plural = "Etapas"
        ordering = ('ordem',)

    def __str__(self):
        prefixo = "Check-in - " if self.is_checkin else ""
        return f"{prefixo}{self.nome}"


class ConfigFoto(models.Model):
    """
    Configura as fotos PADRÃO que devem ser tiradas na etapa de CHECK-IN.
    Outras etapas NÃO terão ConfigFoto, apenas fotos livres.
    """
    oficina = models.ForeignKey(Oficina, on_delete=models.CASCADE, related_name='configs_fotos')
    etapa = models.ForeignKey(Etapa, on_delete=models.CASCADE, related_name='configs_fotos')
    nome = models.CharField(max_length=100, help_text="Ex.: Frente do veículo, Traseira, Painel KM")
    descricao = models.CharField(max_length=255, blank=True, null=True)
    obrigatoria = models.BooleanField(default=True)
    ordem = models.PositiveIntegerField(default=1)

    ativa = models.BooleanField(default=True)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuração de foto"
        verbose_name_plural = "Configurações de fotos"
        ordering = ('ordem',)

    def clean(self):
        # Garante regra de negócio: só permitir configuração de fotos na etapa de check-in
        if self.etapa and not self.etapa.is_checkin:
            raise ValidationError("ConfigFoto só pode ser usada em etapas marcadas como CHECK-IN.")

    def __str__(self):
        return f"{self.nome} ({self.oficina.nome})"


class OS(models.Model):
    """
    Ordem de Serviço da oficina.
    No futuro, essa OS vira uma pasta no Google Drive.
    """
    oficina = models.ForeignKey(Oficina, on_delete=models.CASCADE, related_name='ordens_servico')

    # Identificação
    codigo = models.CharField(
        max_length=50,
        help_text="Número ou código da OS na oficina (ex.: número do sistema de orçamento)."
    )

    # ID da pasta desta OS no Google Drive
    drive_folder_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="ID da pasta desta OS no Google Drive."
    )


    # Dados do veículo
    placa = models.CharField(max_length=10, blank=True, null=True)
    modelo_veiculo = models.CharField(max_length=100, blank=True, null=True)
    cor_veiculo = models.CharField(max_length=50, blank=True, null=True)

    # Dados básicos do cliente
    nome_cliente = models.CharField(max_length=255, blank=True, null=True)
    telefone_cliente = models.CharField(max_length=20, blank=True, null=True)

    # Processo
    etapa_atual = models.ForeignKey(
        Etapa,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='os_na_etapa',
        help_text="Etapa atual do processo desta OS."
    )
    observacoes = models.TextField(blank=True, null=True)

    # Datas
    data_entrada = models.DateTimeField(blank=True, null=True)
    data_prevista_entrega = models.DateTimeField(blank=True, null=True)
    data_saida = models.DateTimeField(blank=True, null=True)

    aberta = models.BooleanField(default=True)

    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)


    class Meta:
        verbose_name = "Ordem de Serviço"
        verbose_name_plural = "Ordens de Serviço"
        ordering = ('-criado_em',)
        unique_together = ('oficina', 'codigo')

    def __str__(self):
        return f"OS {self.codigo} - {self.placa or ''} - {self.oficina.nome}"

class FotoOS(models.Model):
    """
    Foto vinculada a uma OS.
    Pode ser:
    - PADRÃO: ligada a uma ConfigFoto de CHECK-IN
    - LIVRE: foto tirada livremente em qualquer etapa
    """
    TIPO_CHOICES = (
        ('PADRAO', 'Foto padrão'),
        ('LIVRE', 'Foto livre'),
    )

    os = models.ForeignKey(OS, on_delete=models.CASCADE, related_name='fotos')
    etapa = models.ForeignKey(
        Etapa,
        on_delete=models.CASCADE,
        related_name='fotos',
        null=True,
        blank=True,
    )
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)

    # Se for PADRÃO, aponta para a configuração de foto do check-in
    config_foto = models.ForeignKey(
        ConfigFoto,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fotos',
        help_text="Preencher apenas se for foto padrão de CHECK-IN."
    )

    # Arquivo físico (mais tarde será integrado ao Google Drive)
    arquivo = models.FileField(
        upload_to='os_fotos/',
        max_length=255,
        help_text="Caminho/arquivo da foto. No futuro pode ser apenas um link externo."
    )

    drive_file_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="ID do arquivo correspondente no Google Drive."
    )

    # Informações adicionais
    titulo = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Opcional. Útil para fotos LIVRES (ex.: 'Detalhe amassado porta esquerda')."
    )
    observacao = models.CharField(max_length=255, blank=True, null=True)

    tirada_por = models.ForeignKey(
        UsuarioOficina,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fotos_tiradas'
    )
    tirada_em = models.DateTimeField(auto_now_add=True)


    class Meta:
        verbose_name = "Foto da OS"
        verbose_name_plural = "Fotos da OS"
        ordering = ('tirada_em',)

    def clean(self):
        """
        Valida as regras de negócio:
        - Se tipo == PADRAO -> precisa de config_foto e a etapa deve ser a mesma da config
        - Se tipo == LIVRE -> config_foto deve ser vazia
        """
        # Segurança: garantir que temos OS antes
        if not self.os:
            return

        # Foto padrão
        if self.tipo == 'PADRAO':
            if not self.etapa:
                raise ValidationError("Fotos do tipo PADRÃO precisam estar vinculadas a uma etapa.")

            if not self.config_foto:
                raise ValidationError("Fotos do tipo PADRÃO precisam ter uma ConfigFoto associada.")

            if not self.config_foto.etapa.is_checkin:
                raise ValidationError("ConfigFoto só pode ser usada em etapa de CHECK-IN.")

            # Etapa da foto precisa ser a mesma da ConfigFoto
            if self.config_foto.etapa_id != self.etapa_id:
                raise ValidationError("A etapa da foto deve ser a mesma da ConfigFoto.")

            # Oficina da ConfigFoto deve ser a mesma da OS
            if self.config_foto.oficina_id != self.os.oficina_id:
                raise ValidationError("A ConfigFoto deve pertencer à mesma oficina da OS.")

        # Foto livre
        if self.tipo == 'LIVRE':
            if self.config_foto is not None:
                raise ValidationError("Fotos LIVRES não podem ter ConfigFoto associada.")

    def __str__(self):
        base = f"Foto {self.id} - OS {self.os.codigo}"
        if self.tipo == 'PADRAO' and self.config_foto:
            return f"{base} - PADRÃO ({self.config_foto.nome})"
        if self.titulo:
            return f"{base} - LIVRE ({self.titulo})"
        return base





class ObservacaoEtapaOS(models.Model):
    os = models.ForeignKey(OS, on_delete=models.CASCADE, related_name='observacoes_etapas')
    etapa = models.ForeignKey(Etapa, on_delete=models.CASCADE, related_name='observacoes_os')
    texto = models.TextField()
    criado_por = models.ForeignKey(
        UsuarioOficina,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='observacoes_criadas',
    )

    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('os', 'etapa')
        verbose_name = "Observação da Etapa"
        verbose_name_plural = "Observações das Etapas"

    def __str__(self):
        return f"OS {self.os.codigo} - {self.etapa.nome}"


class OficinaDriveConfig(models.Model):
    """
    Configuração de integração com o Google Drive para uma oficina.
    Armazena a pasta raiz e as credenciais OAuth.
    """
    oficina = models.OneToOneField(
        'Oficina',
        on_delete=models.CASCADE,
        related_name='drive_config'
    )
    root_folder_id = models.CharField(
        max_length=255,
        help_text="ID da pasta raiz no Google Drive onde as OS desta oficina serão criadas."
    )
    credentials_json = models.TextField(
        help_text="Credenciais OAuth serializadas (JSON) para acessar o Drive desta oficina."
    )
    ativo = models.BooleanField(default=True)

    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuração Google Drive"
        verbose_name_plural = "Configurações Google Drive"

    def __str__(self):
        return f"Drive {self.oficina.nome} ({'Ativo' if self.ativo else 'Inativo'})"
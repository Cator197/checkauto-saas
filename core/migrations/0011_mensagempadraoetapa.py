from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_fotoos_soft_delete_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="MensagemPadraoEtapa",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("texto", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "etapa",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mensagens_padrao",
                        to="core.etapa",
                    ),
                ),
                (
                    "oficina",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mensagens_padrao",
                        to="core.oficina",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="mensagens_padrao_atualizadas",
                        to="core.usuariooficina",
                    ),
                ),
            ],
            options={
                "verbose_name": "Mensagem padrão da etapa",
                "verbose_name_plural": "Mensagens padrão das etapas",
            },
        ),
        migrations.AddConstraint(
            model_name="mensagempadraoetapa",
            constraint=models.UniqueConstraint(
                fields=("oficina", "etapa"),
                name="uniq_msg_oficina_etapa",
            ),
        ),
    ]

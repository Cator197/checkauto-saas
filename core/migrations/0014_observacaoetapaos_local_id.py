from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_add_is_atual_usuariooficina"),
    ]

    operations = [
        migrations.AddField(
            model_name="observacaoetapaos",
            name="local_id",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="observacaoetapaos",
            constraint=models.UniqueConstraint(
                condition=models.Q(("local_id__isnull", False)),
                fields=("os", "local_id"),
                name="uniq_observacao_os_local_id",
            ),
        ),
    ]

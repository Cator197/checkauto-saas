from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_remove_observacaoetapaos_unique"),
    ]

    operations = [
        migrations.AddField(
            model_name="fotoos",
            name="is_deleted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="fotoos",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="fotoos",
            name="deleted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="fotos_deletadas",
                to="core.usuariooficina",
            ),
        ),
        migrations.AddField(
            model_name="fotoos",
            name="is_indisponivel",
            field=models.BooleanField(default=False),
        ),
    ]

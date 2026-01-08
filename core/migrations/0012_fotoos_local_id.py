from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0011_mensagempadraoetapa"),
    ]

    operations = [
        migrations.AddField(
            model_name="fotoos",
            name="local_id",
            field=models.CharField(
                max_length=36,
                null=True,
                blank=True,
                db_index=True,
                help_text="UUID local do PWA para garantir idempotência no sync.",
            ),
        ),
    ]

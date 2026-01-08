from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0012_fotoos_local_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="usuariooficina",
            name="is_atual",
            field=models.BooleanField(default=False),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_alter_checkinpergunta_etapa_nullable"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="checkinpergunta",
            name="etapa",
        ),
        migrations.RemoveField(
            model_name="checkinpergunta",
            name="tipo_resposta",
        ),
        migrations.AddField(
            model_name="checkinpergunta",
            name="permite_texto",
            field=models.BooleanField(default=False),
        ),
        migrations.DeleteModel(
            name="CheckinPerguntaOpcao",
        ),
    ]

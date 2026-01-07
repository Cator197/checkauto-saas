from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0008_osetapastatus"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="observacaoetapaos",
            unique_together=set(),
        ),
    ]

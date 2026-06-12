from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0005_client_phone_normalized_type_birthdate'),
    ]

    operations = [
        migrations.AddField(
            model_name='client',
            name='matricule_fiscale',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Tax registration number for business clients (shown on invoices).',
                max_length=50,
                verbose_name='Matricule Fiscale',
            ),
        ),
    ]

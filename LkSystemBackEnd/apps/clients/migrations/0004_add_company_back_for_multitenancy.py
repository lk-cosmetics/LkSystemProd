# Generated migration to add company field back for multi-tenancy

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('company', '0003_alter_company_abbreviation_alter_company_legal_name'),
        ('clients', '0003_remove_client_company_and_phone_unique'),
    ]

    operations = [
        migrations.AddField(
            model_name='client',
            name='company',
            field=models.ForeignKey(
                blank=True,
                help_text='Tenant that owns this client record',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='clients',
                to='company.company',
                verbose_name='Company',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='client',
            unique_together={('company', 'email')},
        ),
        migrations.AddIndex(
            model_name='client',
            index=models.Index(fields=['company', 'email'], name='client_company_597da1_idx'),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('company', '0003_alter_company_abbreviation_alter_company_legal_name'),
    ]

    operations = [
        migrations.AddField(
            model_name='company',
            name='invoice_footer',
            field=models.TextField(
                blank=True,
                default='',
                help_text='Custom text shown at the bottom of invoices (terms, legal mentions…)',
                verbose_name='Invoice Footer',
            ),
        ),
    ]

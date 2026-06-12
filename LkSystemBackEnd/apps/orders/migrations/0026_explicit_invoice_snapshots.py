from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def clear_automatically_assigned_invoices(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    Order.objects.exclude(invoice_number='').update(invoice_number='')


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0025_order_invoice_number'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='invoice_client_address',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_city',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_email',
            field=models.EmailField(blank=True, default='', max_length=254),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_matricule_fiscale',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_phone',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_client_type',
            field=models.CharField(
                blank=True,
                choices=[('PERSON', 'Person'), ('COMPANY', 'Company')],
                default='PERSON',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_date',
            field=models.DateField(
                blank=True,
                db_index=True,
                help_text='Accounting date chosen when the invoice is issued.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_issued_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='invoice_issued_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='issued_order_invoices',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(
            clear_automatically_assigned_invoices,
            migrations.RunPython.noop,
        ),
    ]

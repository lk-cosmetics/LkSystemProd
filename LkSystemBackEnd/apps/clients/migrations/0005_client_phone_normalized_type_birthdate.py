from django.db import migrations, models


def normalize_phone(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if digits.startswith('00216') and len(digits) >= 13:
        digits = digits[5:]
    elif digits.startswith('216') and len(digits) >= 11:
        digits = digits[3:]
    if len(digits) > 8:
        digits = digits[-8:]
    return digits


def backfill_phone_normalized(apps, schema_editor):
    Client = apps.get_model('clients', 'Client')
    for client in Client.objects.all().only('id', 'phone'):
        normalized = normalize_phone(client.phone)
        if normalized:
            client.phone_normalized = normalized
            client.save(update_fields=['phone_normalized'])


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0004_add_company_back_for_multitenancy'),
    ]

    operations = [
        migrations.AddField(
            model_name='client',
            name='phone_normalized',
            field=models.CharField(blank=True, db_index=True, default='', help_text='Normalized phone key used for duplicate detection.', max_length=20),
        ),
        migrations.AddField(
            model_name='client',
            name='client_type',
            field=models.CharField(choices=[('PERSON', 'Person'), ('COMPANY', 'Company')], db_index=True, default='PERSON', max_length=20),
        ),
        migrations.AddField(
            model_name='client',
            name='date_of_birth',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='client',
            index=models.Index(fields=['company', 'phone_normalized'], name='client_company_phone_norm_idx'),
        ),
        migrations.AddIndex(
            model_name='client',
            index=models.Index(fields=['company', 'client_type'], name='client_company_type_idx'),
        ),
        migrations.RunPython(backfill_phone_normalized, migrations.RunPython.noop),
    ]

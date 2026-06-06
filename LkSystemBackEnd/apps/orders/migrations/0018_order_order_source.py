from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0017_order_stock_reserved'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='order_source',
            field=models.CharField(
                blank=True,
                choices=[
                    ('instagram', 'Instagram'),
                    ('whatsapp', 'WhatsApp'),
                    ('facebook', 'Facebook'),
                    ('tiktok', 'TikTok'),
                    ('other', 'Other'),
                ],
                default='',
                help_text='Social channel a manual order originated from (Instagram, …).',
                max_length=20,
            ),
        ),
    ]

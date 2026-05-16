from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0008_pos_routing_jax_delivery_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='ticket_id',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Human-facing POS ticket identifier. Offline tickets can provide their own safe ID.',
                max_length=80,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='client_ticket_uuid',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Client-generated UUID used to idempotently sync offline POS tickets.',
                max_length=64,
            ),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'ticket_id'], name='order_ticket_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'client_ticket_uuid'], name='order_client_ticket_idx'),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.UniqueConstraint(
                condition=~models.Q(client_ticket_uuid=''),
                fields=('company', 'client_ticket_uuid'),
                name='unique_order_client_ticket_uuid',
            ),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.UniqueConstraint(
                condition=~models.Q(ticket_id=''),
                fields=('company', 'ticket_id'),
                name='unique_order_ticket_id_per_company',
            ),
        ),
    ]

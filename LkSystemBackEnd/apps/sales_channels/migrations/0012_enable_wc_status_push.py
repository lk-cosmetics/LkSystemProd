from django.db import migrations, models


def enable_for_existing_woocommerce_channels(apps, schema_editor):
    """Turn the status push ON for every existing WooCommerce channel, so order
    completion / cancellation / return now syncs back to the website without an
    operator hunting for the toggle. POS channels are unaffected (they never
    push). The per-channel toggle remains for opting a store back out."""
    SalesChannel = apps.get_model('sales_channels', 'SalesChannel')
    SalesChannel.objects.filter(channel_type='WOOCOMMERCE').update(wc_push_status_enabled=True)


def noop_reverse(apps, schema_editor):
    # The flag is now caller-managed per channel; nothing to undo on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0011_cashdeposit'),
    ]

    operations = [
        migrations.AlterField(
            model_name='saleschannel',
            name='wc_push_status_enabled',
            field=models.BooleanField(
                default=True,
                help_text=(
                    'When enabled, completing an order in the system (e.g. after '
                    'packaging) pushes the mapped status (completed / cancelled / …) '
                    'back to this WooCommerce store. A failed push never changes the '
                    'local status — it is recorded for a retry.'
                ),
                verbose_name='Push order status to WooCommerce',
            ),
        ),
        migrations.RunPython(enable_for_existing_woocommerce_channels, noop_reverse),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):
    """Delivery contact phone.

    The recipient's phone can differ from the client's (people order for
    family/friends). WooCommerce ships it in the ``shipping.phone`` field
    (WC >= 5.6); operators can also edit it on the order. Blank for older
    orders — readers fall back to ``billing_phone`` via ``delivery_phone``.
    """

    dependencies = [
        ('orders', '0019_order_delivery_fee'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='shipping_phone',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
    ]

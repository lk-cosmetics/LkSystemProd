from django.db import migrations, models
from django.db.models import Q


def local_products_use_null_wc_id(apps, schema_editor):
    Product = apps.get_model('products', 'Product')
    Product.objects.filter(wc_product_id=0).update(wc_product_id=None)


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0006_product_is_pack_product_pack_items'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='product',
            unique_together=set(),
        ),
        migrations.AlterField(
            model_name='product',
            name='wc_product_id',
            field=models.PositiveIntegerField(
                blank=True,
                default=None,
                help_text='Unique identifier from WooCommerce (null for local-only products)',
                null=True,
                verbose_name='WooCommerce Product ID',
            ),
        ),
        migrations.RunPython(local_products_use_null_wc_id, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='product',
            constraint=models.UniqueConstraint(
                condition=Q(wc_product_id__isnull=False),
                fields=('brand', 'wc_product_id'),
                name='unique_wc_product_per_brand',
            ),
        ),
    ]

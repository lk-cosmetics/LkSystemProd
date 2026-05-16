"""Add is_pack and pack_items fields for Product Packs/Bundles."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0005_productauditlog_remove_productattribute_product_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='is_pack',
            field=models.BooleanField(
                default=False,
                help_text='Whether this product is a pack composed of other products',
                verbose_name='Is Pack / Bundle',
            ),
        ),
        migrations.AddField(
            model_name='product',
            name='pack_items',
            field=models.JSONField(
                blank=True,
                help_text='JSON list: [{"product_id": int, "quantity": int}, ...]',
                null=True,
                verbose_name='Pack Items',
            ),
        ),
    ]

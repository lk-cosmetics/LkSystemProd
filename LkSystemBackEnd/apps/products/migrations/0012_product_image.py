"""Add an optional locally-uploaded image field to Product.

Additive only — keeps the existing ``image_url`` CharField (still populated by
the WooCommerce sync). When a user uploads a file via the product form, the
serializer mirrors the uploaded file's served URL into ``image_url`` so every
existing render path (POS cards, order lines, BI, pack builder) shows it with
no further changes.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0011_canonical_product_types'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='image',
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to='products/images/',
                verbose_name='Uploaded Image',
                help_text=(
                    'Locally uploaded product image. When set, its served URL is '
                    'mirrored into image_url so every existing display path renders it.'
                ),
            ),
        ),
    ]

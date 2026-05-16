# Generated manually for BOM/production inventory support.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0007_nullable_wc_product_id'),
    ]

    operations = [
        migrations.AlterField(
            model_name='product',
            name='product_type',
            field=models.CharField(
                choices=[
                    ('resell', 'Resell Product'),
                    ('packaging', 'Packaging / Emballage'),
                    ('finished', 'Finished Product'),
                    ('component', 'Component'),
                    ('raw_material', 'Raw Material'),
                ],
                default='resell',
                max_length=20,
                verbose_name='Product Type',
            ),
        ),
    ]

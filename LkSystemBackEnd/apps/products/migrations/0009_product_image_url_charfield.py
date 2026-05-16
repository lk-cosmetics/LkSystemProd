from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0008_add_manufacturing_product_types'),
    ]

    operations = [
        migrations.AlterField(
            model_name='product',
            name='image_url',
            field=models.CharField(blank=True, default='', max_length=500, verbose_name='Image URL'),
        ),
    ]

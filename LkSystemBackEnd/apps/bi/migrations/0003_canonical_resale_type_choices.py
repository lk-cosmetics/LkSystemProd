# Generated manually — align DailyProductResaleStats.resale_type choices with the
# canonical Product.ProductType taxonomy (resell_product / pack / component /
# packaging_item). This is a no-op at the database level (choices are advisory);
# it only keeps the migration state in sync with the model so `makemigrations
# --check` stays clean. Existing historical rows are left untouched.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bi', '0002_rename_bi_brand_ch_c_b_d_idx_bi_daily_br_company_ed3809_idx_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='dailyproductresalestats',
            name='resale_type',
            field=models.CharField(
                choices=[
                    ('resell_product', 'Resell Product'),
                    ('pack', 'Pack'),
                    ('component', 'Component'),
                    ('packaging_item', 'Packaging Item'),
                ],
                max_length=32,
            ),
        ),
    ]

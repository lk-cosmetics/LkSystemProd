from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('company', '0003_alter_company_abbreviation_alter_company_legal_name'),
        ('brands', '0001_initial'),
        ('sales_channels', '0008_expense'),
    ]

    operations = [
        migrations.CreateModel(
            name='DailyBrandChannelStats',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('date', models.DateField(db_index=True)),
                ('revenue', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=16)),
                ('orders_count', models.PositiveIntegerField(default=0)),
                ('customers_count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('brand', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bi_daily_channel_stats',
                    to='brands.brand',
                )),
                ('company', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bi_daily_channel_stats',
                    to='company.company',
                )),
                ('sales_channel', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bi_daily_stats',
                    to='sales_channels.saleschannel',
                )),
            ],
            options={
                'verbose_name': 'Daily Brand/Channel Stats',
                'verbose_name_plural': 'Daily Brand/Channel Stats',
                'db_table': 'bi_daily_brand_channel_stats',
                'ordering': ['-date'],
            },
        ),
        migrations.CreateModel(
            name='DailyProductResaleStats',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('date', models.DateField(db_index=True)),
                ('resale_type', models.CharField(choices=[
                    ('resell', 'Resell'),
                    ('packaging', 'Packaging'),
                    ('finished', 'Finished'),
                    ('component', 'Component'),
                    ('raw_material', 'Raw Material'),
                ], max_length=32)),
                ('sales_count', models.PositiveIntegerField(default=0)),
                ('quantity_sold', models.PositiveIntegerField(default=0)),
                ('revenue', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('brand', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bi_daily_resale_stats',
                    to='brands.brand',
                )),
                ('company', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bi_daily_resale_stats',
                    to='company.company',
                )),
            ],
            options={
                'verbose_name': 'Daily Product Resale Stats',
                'verbose_name_plural': 'Daily Product Resale Stats',
                'db_table': 'bi_daily_product_resale_stats',
                'ordering': ['-date'],
            },
        ),
        migrations.AddIndex(
            model_name='dailybrandchannelstats',
            index=models.Index(
                fields=['company', 'brand', 'date'],
                name='bi_brand_ch_c_b_d_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='dailybrandchannelstats',
            index=models.Index(
                fields=['company', 'brand', 'sales_channel', 'date'],
                name='bi_brand_ch_full_idx',
            ),
        ),
        migrations.AddConstraint(
            model_name='dailybrandchannelstats',
            constraint=models.UniqueConstraint(
                fields=['company', 'brand', 'date', 'sales_channel'],
                name='uniq_daily_brand_channel_stats',
            ),
        ),
        migrations.AddIndex(
            model_name='dailyproductresalestats',
            index=models.Index(
                fields=['company', 'brand', 'date'],
                name='bi_resale_c_b_d_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='dailyproductresalestats',
            index=models.Index(
                fields=['company', 'brand', 'resale_type', 'date'],
                name='bi_resale_full_idx',
            ),
        ),
        migrations.AddConstraint(
            model_name='dailyproductresalestats',
            constraint=models.UniqueConstraint(
                fields=['company', 'brand', 'date', 'resale_type'],
                name='uniq_daily_product_resale_stats',
            ),
        ),
    ]

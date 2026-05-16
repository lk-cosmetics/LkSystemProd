# Generated manually for architecture hardening

import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0002_rename_order_company_107b91_idx_sales_order_company_f39d8e_idx_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='deleted_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='orders_deleted',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='discount_type',
            field=models.CharField(
                choices=[('NONE', 'No Discount'), ('FIXED', 'Fixed Amount'), ('PERCENTAGE', 'Percentage')],
                default='NONE',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='discount_value',
            field=models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=14),
        ),
        migrations.AddField(
            model_name='order',
            name='is_deleted',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='orderline',
            name='is_deleted',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='OrderLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('CREATED', 'Created'), ('UPDATED', 'Updated'), ('SOFT_DELETED', 'Soft Deleted'), ('RESTORED', 'Restored'), ('DISCOUNT_APPLIED', 'Discount Applied')], max_length=30)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='logs', to='orders.order')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='order_logs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'order_log',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.CheckConstraint(check=models.Q(('discount_value__gte', Decimal('0.00'))), name='order_discount_value_gte_zero'),
        ),
        migrations.AddConstraint(
            model_name='orderline',
            constraint=models.CheckConstraint(check=models.Q(('quantity__gt', 0)), name='order_line_quantity_gt_zero'),
        ),
        migrations.AddConstraint(
            model_name='orderline',
            constraint=models.CheckConstraint(check=models.Q(('unit_price__gte', Decimal('0.00'))), name='order_line_unit_price_gte_zero'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'is_deleted'], name='sales_order_company_isdel_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['is_deleted'], name='sales_order_isdel_idx'),
        ),
        migrations.AddIndex(
            model_name='orderline',
            index=models.Index(fields=['order', 'is_deleted'], name='order_line_order_isdel_idx'),
        ),
        migrations.AddIndex(
            model_name='orderline',
            index=models.Index(fields=['is_deleted'], name='order_line_isdel_idx'),
        ),
        migrations.AddIndex(
            model_name='orderlog',
            index=models.Index(fields=['order', 'created_at'], name='order_log_order_created_idx'),
        ),
        migrations.AddIndex(
            model_name='orderlog',
            index=models.Index(fields=['action'], name='order_log_action_idx'),
        ),
    ]

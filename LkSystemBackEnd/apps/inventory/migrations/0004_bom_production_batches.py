# Generated manually for BOM/production inventory support.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0003_rename_inv_mov_ref_idx_inventory_m_referen_2707ed_idx_and_more'),
        ('products', '0008_add_manufacturing_product_types'),
        ('sales_channels', '0006_rename_delivery_api_to_key'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='inventorymovement',
            name='movement_type',
            field=models.CharField(
                choices=[
                    ('PURCHASE', 'Purchase/Receipt'),
                    ('RETURN_IN', 'Customer Return'),
                    ('TRANSFER_IN', 'Transfer In'),
                    ('ADJUSTMENT_IN', 'Adjustment (Add)'),
                    ('INITIAL', 'Initial Stock'),
                    ('SALE', 'Sale'),
                    ('RETURN_OUT', 'Return to Supplier'),
                    ('TRANSFER_OUT', 'Transfer Out'),
                    ('ADJUSTMENT_OUT', 'Adjustment (Remove)'),
                    ('DAMAGE', 'Damaged/Expired'),
                    ('SENT_TO_FACTORY', 'Sent to Factory'),
                    ('PRODUCTION_IN', 'Production Receipt'),
                ],
                max_length=20,
                verbose_name='Movement Type',
            ),
        ),
        migrations.CreateModel(
            name='BillOfMaterials',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(blank=True, default='', max_length=255)),
                ('version', models.PositiveIntegerField(default=1)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='boms_created', to=settings.AUTH_USER_MODEL)),
                ('finished_product', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='bill_of_materials', to='products.product', verbose_name='Finished Product')),
            ],
            options={
                'verbose_name': 'Bill of Materials',
                'verbose_name_plural': 'Bills of Materials',
                'db_table': 'bill_of_materials',
            },
        ),
        migrations.CreateModel(
            name='ProductionBatch',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('batch_number', models.CharField(max_length=50, unique=True)),
                ('status', models.CharField(choices=[('DRAFT', 'Draft'), ('SENT_TO_FACTORY', 'Sent to Factory'), ('PARTIALLY_RECEIVED', 'Partially Received'), ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')], db_index=True, default='DRAFT', max_length=30)),
                ('planned_quantity', models.PositiveIntegerField()),
                ('received_quantity', models.PositiveIntegerField(default=0)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('bom', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='production_batches', to='inventory.billofmaterials')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='production_batches_created', to=settings.AUTH_USER_MODEL)),
                ('finished_product', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='production_batches', to='products.product')),
                ('sales_channel', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='production_batches', to='sales_channels.saleschannel')),
            ],
            options={
                'verbose_name': 'Production Batch',
                'verbose_name_plural': 'Production Batches',
                'db_table': 'production_batch',
            },
        ),
        migrations.CreateModel(
            name='BillOfMaterialsItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity_per_unit', models.DecimalField(decimal_places=3, help_text='Use the component base unit, for example bottle=1, cap=1, fragrance_ml=50.', max_digits=12, verbose_name='Quantity Per Finished Unit')),
                ('waste_percent', models.DecimalField(decimal_places=2, default='0.00', help_text='Optional expected waste percentage added when sending to factory.', max_digits=5)),
                ('notes', models.TextField(blank=True, default='')),
                ('bom', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='inventory.billofmaterials')),
                ('component', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='used_in_bom_items', to='products.product', verbose_name='Component Product')),
            ],
            options={
                'verbose_name': 'Bill of Materials Item',
                'verbose_name_plural': 'Bill of Materials Items',
                'db_table': 'bill_of_materials_item',
            },
        ),
        migrations.CreateModel(
            name='ProductionBatchComponent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity_sent', models.PositiveIntegerField()),
                ('quantity_consumed', models.PositiveIntegerField(default=0)),
                ('component', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='production_component_lines', to='products.product')),
                ('production_batch', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='components', to='inventory.productionbatch')),
                ('sent_movement', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='production_component_line', to='inventory.inventorymovement')),
            ],
            options={
                'verbose_name': 'Production Batch Component',
                'verbose_name_plural': 'Production Batch Components',
                'db_table': 'production_batch_component',
            },
        ),
        migrations.AddIndex(
            model_name='billofmaterials',
            index=models.Index(fields=['finished_product'], name='bill_of_mat_finishe_2cfd0f_idx'),
        ),
        migrations.AddIndex(
            model_name='billofmaterials',
            index=models.Index(fields=['is_active'], name='bill_of_mat_is_acti_dfb79d_idx'),
        ),
        migrations.AddIndex(
            model_name='billofmaterialsitem',
            index=models.Index(fields=['bom', 'component'], name='bill_of_mat_bom_id_71d7c8_idx'),
        ),
        migrations.AddIndex(
            model_name='billofmaterialsitem',
            index=models.Index(fields=['component'], name='bill_of_mat_compone_3803bb_idx'),
        ),
        migrations.AddConstraint(
            model_name='billofmaterialsitem',
            constraint=models.UniqueConstraint(fields=('bom', 'component'), name='unique_component_per_bom'),
        ),
        migrations.AddConstraint(
            model_name='billofmaterialsitem',
            constraint=models.CheckConstraint(check=models.Q(('quantity_per_unit__gt', 0)), name='bom_item_quantity_per_unit_gt_zero'),
        ),
        migrations.AddConstraint(
            model_name='billofmaterialsitem',
            constraint=models.CheckConstraint(check=models.Q(('waste_percent__gte', 0)), name='bom_item_waste_percent_gte_zero'),
        ),
        migrations.AddIndex(
            model_name='productionbatch',
            index=models.Index(fields=['sales_channel', 'finished_product'], name='production__sales__2b8179_idx'),
        ),
        migrations.AddIndex(
            model_name='productionbatch',
            index=models.Index(fields=['status'], name='production__status_6db930_idx'),
        ),
        migrations.AddIndex(
            model_name='productionbatch',
            index=models.Index(fields=['created_at'], name='production__created_8f27d0_idx'),
        ),
        migrations.AddConstraint(
            model_name='productionbatch',
            constraint=models.CheckConstraint(check=models.Q(('planned_quantity__gt', 0)), name='production_batch_planned_quantity_gt_zero'),
        ),
        migrations.AddConstraint(
            model_name='productionbatch',
            constraint=models.CheckConstraint(check=models.Q(('received_quantity__gte', 0)), name='production_batch_received_quantity_gte_zero'),
        ),
        migrations.AddConstraint(
            model_name='productionbatch',
            constraint=models.CheckConstraint(check=models.Q(('received_quantity__lte', models.F('planned_quantity'))), name='production_batch_received_lte_planned'),
        ),
        migrations.AddIndex(
            model_name='productionbatchcomponent',
            index=models.Index(fields=['production_batch', 'component'], name='production__product_09a72c_idx'),
        ),
        migrations.AddIndex(
            model_name='productionbatchcomponent',
            index=models.Index(fields=['component'], name='production__compone_4fd201_idx'),
        ),
        migrations.AddConstraint(
            model_name='productionbatchcomponent',
            constraint=models.UniqueConstraint(fields=('production_batch', 'component'), name='unique_component_per_production_batch'),
        ),
        migrations.AddConstraint(
            model_name='productionbatchcomponent',
            constraint=models.CheckConstraint(check=models.Q(('quantity_sent__gt', 0)), name='production_component_quantity_sent_gt_zero'),
        ),
        migrations.AddConstraint(
            model_name='productionbatchcomponent',
            constraint=models.CheckConstraint(check=models.Q(('quantity_consumed__gte', 0)), name='production_component_quantity_consumed_gte_zero'),
        ),
        migrations.AddConstraint(
            model_name='productionbatchcomponent',
            constraint=models.CheckConstraint(check=models.Q(('quantity_consumed__lte', models.F('quantity_sent'))), name='production_component_consumed_lte_sent'),
        ),
    ]

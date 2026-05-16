# Generated manually - Consolidate Store into SalesChannel
# Removes Store model, renames StoreInventory -> SalesChannelInventory,
# changes all FKs from inventory.Store to sales_channels.SalesChannel

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0001_initial'),
        ('sales_channels', '0003_add_store_fields'),
        ('products', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ---- Step 1: Remove old indexes and constraints ----
        # StoreInventory indexes
        migrations.RemoveIndex(
            model_name='storeinventory',
            name='store_inven_store_i_a52619_idx',
        ),
        migrations.RemoveIndex(
            model_name='storeinventory',
            name='store_inven_product_e52cd7_idx',
        ),
        migrations.RemoveIndex(
            model_name='storeinventory',
            name='store_inven_quantit_b2e00a_idx',
        ),
        migrations.AlterUniqueTogether(
            name='storeinventory',
            unique_together=set(),
        ),

        # InventoryMovement indexes
        migrations.RemoveIndex(
            model_name='inventorymovement',
            name='inventory_m_referen_2707ed_idx',
        ),
        migrations.RemoveIndex(
            model_name='inventorymovement',
            name='inventory_m_store_i_eff802_idx',
        ),
        migrations.RemoveIndex(
            model_name='inventorymovement',
            name='inventory_m_movemen_6d66c7_idx',
        ),
        migrations.RemoveIndex(
            model_name='inventorymovement',
            name='inventory_m_status_0e35b5_idx',
        ),
        migrations.RemoveIndex(
            model_name='inventorymovement',
            name='inventory_m_created_b65c6f_idx',
        ),

        # Store indexes and constraints
        migrations.RemoveIndex(
            model_name='store',
            name='store_company_4d2bdb_idx',
        ),
        migrations.RemoveIndex(
            model_name='store',
            name='store_code_91ed9d_idx',
        ),
        migrations.AlterUniqueTogether(
            name='store',
            unique_together=set(),
        ),

        # ---- Step 2: Drop dependent models first ----
        migrations.DeleteModel(
            name='InventoryMovement',
        ),
        migrations.DeleteModel(
            name='StoreInventory',
        ),

        # ---- Step 3: Drop Store model ----
        migrations.DeleteModel(
            name='Store',
        ),

        # ---- Step 4: Create new SalesChannelInventory model ----
        migrations.CreateModel(
            name='SalesChannelInventory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity', models.IntegerField(default=0, help_text='Current stock quantity in this channel', verbose_name='Quantity')),
                ('reserved_quantity', models.IntegerField(default=0, help_text='Quantity reserved for pending orders', verbose_name='Reserved Quantity')),
                ('minimum_quantity', models.IntegerField(default=0, help_text='Reorder point - alert when quantity falls below this', verbose_name='Minimum Quantity')),
                ('maximum_quantity', models.IntegerField(blank=True, help_text='Maximum stock capacity for this channel', null=True, verbose_name='Maximum Quantity')),
                ('bin_location', models.CharField(blank=True, default='', help_text='Shelf/bin location within the channel (e.g., A1-B2)', max_length=50, verbose_name='Bin Location')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('last_counted_at', models.DateTimeField(blank=True, help_text='Date of last physical inventory count', null=True, verbose_name='Last Physical Count')),
                ('product', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sales_channel_inventories', to='products.product', verbose_name='Product')),
                ('sales_channel', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='inventories', to='sales_channels.saleschannel', verbose_name='Sales Channel')),
            ],
            options={
                'verbose_name': 'Sales Channel Inventory',
                'verbose_name_plural': 'Sales Channel Inventories',
                'db_table': 'store_inventory',
            },
        ),

        # ---- Step 5: Create new InventoryMovement model ----
        migrations.CreateModel(
            name='InventoryMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reference_number', models.CharField(help_text='Unique movement reference (auto-generated)', max_length=50, unique=True, verbose_name='Reference Number')),
                ('movement_type', models.CharField(choices=[('PURCHASE', 'Purchase/Receipt'), ('RETURN_IN', 'Customer Return'), ('TRANSFER_IN', 'Transfer In'), ('ADJUSTMENT_IN', 'Adjustment (Add)'), ('INITIAL', 'Initial Stock'), ('SALE', 'Sale'), ('RETURN_OUT', 'Return to Supplier'), ('TRANSFER_OUT', 'Transfer Out'), ('ADJUSTMENT_OUT', 'Adjustment (Remove)'), ('DAMAGE', 'Damaged/Expired')], max_length=20, verbose_name='Movement Type')),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')], default='PENDING', max_length=20, verbose_name='Status')),
                ('quantity', models.IntegerField(help_text='Quantity moved (always positive)', validators=[django.core.validators.MinValueValidator(1)], verbose_name='Quantity')),
                ('quantity_before', models.IntegerField(help_text='Stock level before this movement', verbose_name='Quantity Before')),
                ('quantity_after', models.IntegerField(help_text='Stock level after this movement', verbose_name='Quantity After')),
                ('unit_cost', models.DecimalField(blank=True, decimal_places=2, help_text='Cost per unit for this movement', max_digits=12, null=True, verbose_name='Unit Cost')),
                ('total_cost', models.DecimalField(blank=True, decimal_places=2, help_text='Total cost of this movement', max_digits=14, null=True, verbose_name='Total Cost')),
                ('external_reference', models.CharField(blank=True, default='', help_text='Order ID, Invoice Number, etc.', max_length=100, verbose_name='External Reference')),
                ('notes', models.TextField(blank=True, default='', help_text='Additional notes about this movement', verbose_name='Notes')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True, verbose_name='Completed At')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='inventory_movements_created', to=settings.AUTH_USER_MODEL, verbose_name='Created By')),
                ('product', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='inventory_movements', to='products.product', verbose_name='Product')),
                ('related_movement', models.OneToOneField(blank=True, help_text='The paired movement for transfers', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='paired_movement', to='inventory.inventorymovement', verbose_name='Related Movement')),
                ('sales_channel', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='movements', to='sales_channels.saleschannel', verbose_name='Sales Channel')),
                ('destination_channel', models.ForeignKey(blank=True, help_text='For transfers: destination channel', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='incoming_transfers', to='sales_channels.saleschannel', verbose_name='Destination Channel')),
            ],
            options={
                'verbose_name': 'Inventory Movement',
                'verbose_name_plural': 'Inventory Movements',
                'db_table': 'inventory_movement',
                'ordering': ['-created_at'],
            },
        ),

        # ---- Step 6: Add indexes ----
        migrations.AddIndex(
            model_name='saleschannelinventory',
            index=models.Index(fields=['sales_channel', 'product'], name='store_inven_sales_c_idx'),
        ),
        migrations.AddIndex(
            model_name='saleschannelinventory',
            index=models.Index(fields=['product'], name='store_inven_product_idx'),
        ),
        migrations.AddIndex(
            model_name='saleschannelinventory',
            index=models.Index(fields=['quantity'], name='store_inven_qty_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='saleschannelinventory',
            unique_together={('sales_channel', 'product')},
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['reference_number'], name='inv_mov_ref_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['sales_channel', 'product'], name='inv_mov_channel_product_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['movement_type'], name='inv_mov_type_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['status'], name='inv_mov_status_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['created_at'], name='inv_mov_created_idx'),
        ),
    ]

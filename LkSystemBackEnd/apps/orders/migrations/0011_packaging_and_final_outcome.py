"""Add packaging step, final outcome, and structured return classification.

Companion fields for the new lifecycle:
  • Order.packaging_status / packaged_at / packaged_by
  • Order.final_outcome (KPI source of truth)
  • Order.return_type (structured return classification)
  • OrderLine.return_condition / replacement_product

A separate management command (`backfill_final_outcome`) populates final_outcome
for existing rows. We don't auto-run it here so the operator can review counts.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0010_order_status_separation_edit_lock'),
        ('products', '0008_add_manufacturing_product_types'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── Order: packaging step ─────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='packaging_status',
            field=models.CharField(
                max_length=24,
                choices=[
                    ('NOT_PACKAGED', 'Not Packaged'),
                    ('PACKAGED', 'Packaged'),
                    ('UPDATED', 'Packaging Updated'),
                ],
                default='NOT_PACKAGED',
                db_index=True,
                help_text='Tracks the packaging operator step (separate from POS validation).',
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='packaged_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='order',
            name='packaged_by',
            field=models.ForeignKey(
                to=settings.AUTH_USER_MODEL,
                on_delete=models.deletion.SET_NULL,
                null=True, blank=True,
                related_name='orders_packaged',
            ),
        ),

        # ── Order: final outcome (KPI source of truth) ────────────────────────
        migrations.AddField(
            model_name='order',
            name='final_outcome',
            field=models.CharField(
                max_length=32,
                choices=[
                    ('NONE', 'Pending'),
                    ('SUCCESSFUL_SALE', 'Successful Sale'),
                    ('RETURNED', 'Returned'),
                    ('EXCHANGED', 'Exchanged'),
                    ('CANCELLED_BEFORE_DELIVERY', 'Cancelled Before Delivery'),
                    ('CANCELLED_AFTER_DELIVERY', 'Cancelled After Delivery'),
                    ('FAILED_DELIVERY', 'Failed Delivery'),
                ],
                default='NONE',
                db_index=True,
                help_text='Terminal sales-result for KPIs. Derived from delivery/return state by lifecycle service.',
            ),
        ),

        # ── Order: structured return classification ───────────────────────────
        migrations.AddField(
            model_name='order',
            name='return_type',
            field=models.CharField(
                max_length=24,
                choices=[
                    ('NONE', 'None'),
                    ('CANCELLED_REFUSED', 'Cancelled / Refused at Door'),
                    ('RETURNED', 'Returned'),
                    ('EXCHANGED', 'Exchanged'),
                    ('DAMAGED', 'Damaged on Arrival'),
                    ('MISSING', 'Missing Product'),
                    ('OTHER', 'Other'),
                ],
                default='NONE',
                help_text='Structured return classification, drives stock-restoration rules.',
            ),
        ),

        # ── OrderLine: per-line return condition ──────────────────────────────
        migrations.AddField(
            model_name='orderline',
            name='return_condition',
            field=models.CharField(
                max_length=12,
                choices=[
                    ('NONE', 'Not Returned'),
                    ('GOOD', 'Good Condition'),
                    ('DAMAGED', 'Damaged'),
                    ('MISSING', 'Missing'),
                    ('EXCHANGED', 'Exchanged'),
                ],
                default='NONE',
            ),
        ),
        migrations.AddField(
            model_name='orderline',
            name='replacement_product',
            field=models.ForeignKey(
                to='products.Product',
                on_delete=models.deletion.SET_NULL,
                null=True, blank=True,
                related_name='+',
                help_text='Replacement product when return_condition=EXCHANGED.',
            ),
        ),

        # ── Indexes for KPI queries ───────────────────────────────────────────
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'final_outcome'], name='order_final_outcome_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'packaging_status'], name='order_packaging_status_idx'),
        ),

        # ── OrderLog.Action: extend choices ───────────────────────────────────
        migrations.AlterField(
            model_name='orderlog',
            name='action',
            field=models.CharField(
                max_length=30,
                choices=[
                    ('CREATED', 'Created'),
                    ('UPDATED', 'Updated'),
                    ('SOFT_DELETED', 'Soft Deleted'),
                    ('RESTORED', 'Restored'),
                    ('DISCOUNT_APPLIED', 'Discount Applied'),
                    ('STATUS_CHANGED', 'Status Changed'),
                    ('WOOCOMMERCE_STATUS_CHANGED', 'WooCommerce Status Changed'),
                    ('LOCAL_STATUS_CHANGED', 'Local Status Changed'),
                    ('CONTACT_STATUS_CHANGED', 'Contact Status Changed'),
                    ('DELAY_DATE_CHANGED', 'Delay Date Changed'),
                    ('RETURN_EXCHANGE_CHANGED', 'Return / Exchange Changed'),
                    ('EDIT_LOCK_ACQUIRED', 'Edit Lock Acquired'),
                    ('EDIT_LOCK_RELEASED', 'Edit Lock Released'),
                    ('EDIT_LOCK_TAKEN_OVER', 'Edit Lock Taken Over'),
                    ('OUTCOME_CONFIRMED', 'Confirmed'),
                    ('OUTCOME_DELAYED', 'Delayed'),
                    ('OUTCOME_CANCELLED', 'Cancelled'),
                    ('SYNC_RECEIVED', 'Synced from WooCommerce'),
                    ('SYNC_FAILED', 'Sync Failed'),
                    ('DELIVERY_QUEUED', 'Queued for Delivery'),
                    ('DELIVERY_SUBMITTED', 'Submitted to Provider'),
                    ('DELIVERY_ACCEPTED', 'Accepted by Provider'),
                    ('DELIVERY_FAILED', 'Delivery Failed'),
                    ('DELIVERY_DELIVERED', 'Delivered'),
                    ('DELIVERY_RETURNED', 'Returned to Sender'),
                    ('SENT_TO_POS', 'Sent to POS'),
                    ('POS_VALIDATED', 'POS Validated'),
                    ('RETURN_PROCESSED', 'Return Processed'),
                    ('STOCK_RESTORED', 'Stock Restored'),
                    ('PACKAGED', 'Packaged'),
                    ('PACKAGING_UPDATED', 'Packaging Updated'),
                    ('PACKAGING_REVERSED', 'Packaging Reversed'),
                    ('RETURN_TYPE_SET', 'Return Type Set'),
                    ('FINAL_OUTCOME_CHANGED', 'Final Outcome Changed'),
                    ('DAMAGED_STOCK_RECORDED', 'Damaged Stock Recorded'),
                    ('REPLACEMENT_DEDUCTED', 'Replacement Product Deducted'),
                ],
            ),
        ),
    ]

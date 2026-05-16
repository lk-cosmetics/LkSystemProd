"""Phase 2 schema additions:
 - Order.workflow_status (10-state derived UI status)
 - Order.not_answered_at, auto_cancelled_at, auto_cancel_reason
 - Order.loyalty_points_granted / _granted_at / _amount
 - OrderLine.is_linked, unlinked_reason
 - OrderLog.Action enum extended with 6 new values
 - Indexes for (company, workflow_status) and (company, contact_status, not_answered_at)
 - RunPython backfill of workflow_status from existing rows

The runtime derivation lives in lifecycle_service._derive_workflow_status, but
since migrations load historical models we duplicate the logic locally.
"""

from django.conf import settings
from django.db import migrations, models


# ── workflow derivation (kept in sync with lifecycle_service._derive_workflow_status) ──

_IN_FLIGHT = {'QUEUED', 'SUBMITTED', 'ACCEPTED', 'IN_TRANSIT'}


def _derive(order) -> str:
    if order.is_deleted:
        return 'cancelled'  # hidden by manager anyway
    if order.return_exchange_status == 'EXCHANGED' or order.final_outcome == 'EXCHANGED':
        return 'changed'
    if order.returned_at or order.delivery_status == 'RETURNED' or order.final_outcome == 'RETURNED':
        return 'retour'
    if order.status == 'CANCELLED' or order.outcome == 'CANCELLED':
        return 'cancelled'
    if order.final_outcome == 'SUCCESSFUL_SALE':
        return 'done'
    if order.packaging_status in ('PACKAGED', 'UPDATED') and order.delivery_status in _IN_FLIGHT:
        return 'packaging'
    if order.delivery_status in _IN_FLIGHT or order.delivery_reference:
        return 'sent_to_delivery'
    if order.outcome == 'DELAYED' or order.contact_status == 'DELAYED':
        return 'delayed'
    if order.outcome == 'CONFIRMED':
        return 'answered'
    if order.contact_status == 'NOT_ANSWERED':
        return 'not_answered'
    return 'pending'


def backfill_workflow_status(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    # iterate the unmanaged manager so soft-deleted rows are processed too
    qs = Order.objects.all()
    batch = []
    for order in qs.iterator(chunk_size=500):
        new = _derive(order)
        if order.workflow_status != new:
            order.workflow_status = new
            batch.append(order)
        if len(batch) >= 500:
            Order.objects.bulk_update(batch, ['workflow_status'])
            batch.clear()
    if batch:
        Order.objects.bulk_update(batch, ['workflow_status'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0011_packaging_and_final_outcome'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── Order: workflow_status + auto-cancel + loyalty fields ─────────────
        migrations.AddField(
            model_name='order',
            name='workflow_status',
            field=models.CharField(
                max_length=24,
                choices=[
                    ('pending', 'Pending'),
                    ('answered', 'Answered'),
                    ('not_answered', 'Not Answered'),
                    ('delayed', 'Delayed'),
                    ('sent_to_delivery', 'Sent to Delivery'),
                    ('packaging', 'Packaging'),
                    ('done', 'Done'),
                    ('retour', 'Retour'),
                    ('cancelled', 'Cancelled'),
                    ('changed', 'Changed'),
                ],
                default='pending',
                db_index=True,
                help_text='10-state main workflow status used by the orders UI tabs and row badge.',
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='not_answered_at',
            field=models.DateTimeField(null=True, blank=True, db_index=True),
        ),
        migrations.AddField(
            model_name='order',
            name='auto_cancelled_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='order',
            name='auto_cancel_reason',
            field=models.CharField(max_length=120, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='order',
            name='loyalty_points_granted',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='order',
            name='loyalty_points_granted_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='order',
            name='loyalty_points_amount',
            field=models.PositiveIntegerField(default=0),
        ),

        # ── OrderLine: WC linking flags ───────────────────────────────────────
        migrations.AddField(
            model_name='orderline',
            name='is_linked',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='orderline',
            name='unlinked_reason',
            field=models.CharField(max_length=40, blank=True, default=''),
        ),

        # ── Indexes ───────────────────────────────────────────────────────────
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'workflow_status'], name='order_workflow_status_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'contact_status', 'not_answered_at'], name='order_not_answered_at_idx'),
        ),

        # ── Extend OrderLog.Action choices ────────────────────────────────────
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
                    ('WORKFLOW_STATUS_CHANGED', 'Workflow Status Changed'),
                    ('AUTO_CANCELLED', 'Auto Cancelled (System)'),
                    ('POINTS_GRANTED', 'Loyalty Points Granted'),
                    ('POINTS_REVERSED', 'Loyalty Points Reversed'),
                    ('WC_PRODUCT_LINKED', 'WC Product Linked'),
                    ('WC_PRODUCT_UNLINKED', 'WC Product Unlinked'),
                ],
            ),
        ),

        # ── Backfill workflow_status for existing rows ───────────────────────
        migrations.RunPython(backfill_workflow_status, noop_reverse),
    ]

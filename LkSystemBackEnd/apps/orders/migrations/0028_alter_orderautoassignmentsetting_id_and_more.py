from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0027_order_assignment'),
    ]

    operations = [
        migrations.AlterField(
            model_name='orderautoassignmentsetting',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
        migrations.AlterField(
            model_name='orderlog',
            name='action',
            field=models.CharField(choices=[('CREATED', 'Created'), ('UPDATED', 'Updated'), ('SOFT_DELETED', 'Soft Deleted'), ('RESTORED', 'Restored'), ('DISCOUNT_APPLIED', 'Discount Applied'), ('STATUS_CHANGED', 'Status Changed'), ('WOOCOMMERCE_STATUS_CHANGED', 'WooCommerce Status Changed'), ('LOCAL_STATUS_CHANGED', 'Local Status Changed'), ('CONTACT_STATUS_CHANGED', 'Contact Status Changed'), ('DELAY_DATE_CHANGED', 'Delay Date Changed'), ('RETURN_EXCHANGE_CHANGED', 'Return / Exchange Changed'), ('EDIT_LOCK_ACQUIRED', 'Edit Lock Acquired'), ('EDIT_LOCK_RELEASED', 'Edit Lock Released'), ('EDIT_LOCK_TAKEN_OVER', 'Edit Lock Taken Over'), ('OUTCOME_CONFIRMED', 'Confirmed'), ('OUTCOME_DELAYED', 'Delayed'), ('OUTCOME_CANCELLED', 'Cancelled'), ('SYNC_RECEIVED', 'Synced from WooCommerce'), ('SYNC_FAILED', 'Sync Failed'), ('DELIVERY_QUEUED', 'Queued for Delivery'), ('DELIVERY_SUBMITTED', 'Submitted to Provider'), ('DELIVERY_ACCEPTED', 'Accepted by Provider'), ('DELIVERY_FAILED', 'Delivery Failed'), ('DELIVERY_DELIVERED', 'Delivered'), ('DELIVERY_RETURNED', 'Returned to Sender'), ('SENT_TO_POS', 'Sent to POS'), ('POS_VALIDATED', 'POS Validated'), ('RETURN_PROCESSED', 'Return Processed'), ('STOCK_RESTORED', 'Stock Restored'), ('PACKAGED', 'Packaged'), ('PACKAGING_UPDATED', 'Packaging Updated'), ('PACKAGING_REVERSED', 'Packaging Reversed'), ('RETURN_TYPE_SET', 'Return Type Set'), ('FINAL_OUTCOME_CHANGED', 'Final Outcome Changed'), ('DAMAGED_STOCK_RECORDED', 'Damaged Stock Recorded'), ('REPLACEMENT_DEDUCTED', 'Replacement Product Deducted'), ('WORKFLOW_STATUS_CHANGED', 'Workflow Status Changed'), ('AUTO_CANCELLED', 'Auto Cancelled (System)'), ('POINTS_GRANTED', 'Loyalty Points Granted'), ('POINTS_REVERSED', 'Loyalty Points Reversed'), ('WC_PRODUCT_LINKED', 'WC Product Linked'), ('WC_PRODUCT_UNLINKED', 'WC Product Unlinked'), ('ORDER_STATUS_CHANGED', 'Order Status Changed'), ('MANUAL_STATUS_OVERRIDE', 'Manual Status Override'), ('WC_CANCEL_SYNCED', 'WooCommerce Cancel Synced'), ('WC_SYNC_RETRIED', 'WooCommerce Sync Retried'), ('ASSIGNED', 'Assigned to Employee'), ('UNASSIGNED', 'Assignment Cleared')], max_length=30),
        ),
    ]

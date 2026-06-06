"""
LkSystem Orders App - Webhook Handler Registration
═══════════════════════════════════════════════════════════════════════════════
Listens for order.created, order.updated, order.deleted, order.restored
from WooCommerce and feeds them through the unified OrderIngestionService.

v2 fixes:
  • A FRESH OrderIngestionService is created per webhook call — no shared
    instance with a stale cross-channel product cache.
  • order.deleted topic is now handled: soft-deletes the local order.
  • order.restored topic is now handled: restores a soft-deleted order.
  • Only PROCESSING website orders are ingested as new operational orders.
"""

import logging
from apps.orders.models import Order

logger = logging.getLogger(__name__)

WC_IMPORT_STATUS = 'processing'


def register_webhook_handlers():
    """
    Register order webhook handlers with the central webhook registry.
    Called from OrdersConfig.ready().
    """
    try:
        from core.webhooks import webhook_registry
        from core.webhooks.validators import WebhookContext
        from apps.orders.service import OrderIngestionService, OrderIngestionError
        from apps.orders.models import Order, OrderLog
        from apps.orders.logging_service import OrderLoggingService

        # ── order.created / order.updated ─────────────────────────────────

        def handle_order_upsert(context: WebhookContext) -> dict:
            """
            Unified handler for order.created and order.updated.

            A FRESH service instance is created on every call to prevent
            cross-channel cache pollution between concurrent webhook requests.
            """
            payload = context.payload
            if not payload or 'id' not in payload:
                return {'detail': 'No order data in payload'}
            
            wc_status = (payload.get('status') or '').lower()
            if wc_status != WC_IMPORT_STATUS:
                logger.info(
                    "WooCommerce order WC#%s received via webhook but NOT imported — "
                    "its status is '%s' (only '%s' orders are imported).",
                    payload.get('id'), wc_status or 'unknown', WC_IMPORT_STATUS,
                )
                return {
                    'detail': f'Order ignored until {WC_IMPORT_STATUS}',
                    'status': wc_status or None,
                }

            # Fresh instance per request — never reuse across calls
            ingestion = OrderIngestionService()

            try:
                order, created = ingestion.ingest(
                    payload=payload,
                    sales_channel=context.sales_channel,
                    source=Order.Source.WOOCOMMERCE,
                )
                action = 'created' if created else 'updated'
                logger.info(
                    "WooCommerce order WC#%s %s via webhook → local order %s",
                    payload.get('id'), action, order.order_number,
                )

                # Auto-enqueue delivery for PROCESSING orders
                _maybe_enqueue_delivery(order)

                return {
                    'detail':       f'Order {action} successfully',
                    'order_id':     order.id,
                    'order_number': order.order_number,
                    'action':       action,
                }
            except OrderIngestionError as exc:
                logger.warning(
                    "OrderIngestionError in webhook: %s | %s", exc.message, exc.details,
                )
                return {'detail': f'Ingestion error: {exc.message}'}
            except Exception as exc:
                logger.exception("Unexpected error ingesting order: %s", exc)
                return {'detail': f'Error: {exc}'}

        # ── order.deleted ──────────────────────────────────────────────────

        def handle_order_deleted(context: WebhookContext) -> dict:
            """
            Soft-delete the local order when WooCommerce deletes it.
            The order row is retained for audit/financial history.
            """
            payload = context.payload
            wc_id   = str(payload.get('id', ''))

            if not wc_id:
                return {'detail': 'No order ID in deletion payload'}

            company = context.sales_channel.brand.company
            try:
                order = Order.all_objects.get(
                    company=company, external_order_id=wc_id,
                )
                if not order.is_deleted:
                    order.soft_delete(reason='Deleted in WooCommerce via webhook')
                return {
                    'detail':   'Order soft-deleted',
                    'order_id': order.id,
                }
            except Order.DoesNotExist:
                return {'detail': f'Order WC#{wc_id} not found locally — no action needed'}

        # ── order.restored ─────────────────────────────────────────────────

        def handle_order_restored(context: WebhookContext) -> dict:
            """
            Restore a previously soft-deleted order when WooCommerce restores it.
            """
            payload = context.payload
            wc_id   = str(payload.get('id', ''))

            if not wc_id:
                return {'detail': 'No order ID in restore payload'}

            company = context.sales_channel.brand.company
            try:
                order = Order.all_objects.get(
                    company=company, external_order_id=wc_id,
                )
                if order.is_deleted:
                    order.restore()
                return {
                    'detail':   'Order restored',
                    'order_id': order.id,
                }
            except Order.DoesNotExist:
                # Not found locally — treat as a new order event
                return handle_order_upsert(context)

        # ── register all handlers ──────────────────────────────────────────

        webhook_registry.register_handler(
            handler=handle_order_upsert,
            topics=['order.created', 'order.updated'],
            name='OrderIngestionHandler',
            description='Ingest WooCommerce orders via OrderIngestionService (fresh instance per call)',
        )
        webhook_registry.register_handler(
            handler=handle_order_deleted,
            topics=['order.deleted'],
            name='OrderDeletionHandler',
            description='Soft-delete local order when deleted in WooCommerce',
        )
        webhook_registry.register_handler(
            handler=handle_order_restored,
            topics=['order.restored'],
            name='OrderRestoreHandler',
            description='Restore local order when restored in WooCommerce',
        )

        logger.info("Order webhook handlers registered (upsert, delete, restore)")

    except Exception as exc:
        logger.error("Failed to register order webhook handlers: %s", exc)


def _maybe_enqueue_delivery(order: Order) -> None:
    """
    Enqueue delivery submission for newly PROCESSING orders if Celery is up.
    Does nothing silently if Celery is not configured or order is ineligible.
    """
    if not order.can_submit_delivery:
        return
    try:
        from apps.orders.tasks import submit_order_to_delivery
        submit_order_to_delivery.delay(order.id)
        logger.info("Enqueued delivery submission for order %s", order.order_number)
    except Exception as exc:
        # Never let delivery queuing break the webhook response
        logger.warning(
            "Could not enqueue delivery for order %s: %s", order.order_number, exc,
        )

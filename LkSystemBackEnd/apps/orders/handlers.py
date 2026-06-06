"""
LkSystem Orders App - Webhook Handler Registration
═══════════════════════════════════════════════════════════════════════════════
Listens for order.created / order.updated / order.deleted / order.restored from
WooCommerce.

Throughput: WooCommerce can fire hundreds or thousands of order events at once.
So the registered handlers do almost no work on the request path — they hand the
heavy fetch + ingest off to a Celery task (``orders.process_wc_order_webhook``)
and return immediately, keeping the webhook response in the millisecond range and
letting the worker pull the load at its own pace (Redis-backed queue).

If Celery / Redis is unavailable, the exact same logic runs INLINE as a fallback,
so the system keeps working without a broker.
"""

import logging

from apps.orders.models import Order

logger = logging.getLogger(__name__)

WC_IMPORT_STATUS = 'processing'
WC_API_TIMEOUT_SECONDS = 15


# ═════════════════════════════════════════════════════════════════════════════
# Core logic — runs inside the Celery worker (or inline as a fallback)
# ═════════════════════════════════════════════════════════════════════════════

def ingest_wc_order(sales_channel, payload: dict) -> dict:
    """order.created / order.updated — ingest a single WooCommerce order with full
    client + product data, then notify + enqueue delivery. Idempotent."""
    from apps.orders.service import OrderIngestionError, OrderIngestionService

    if not payload or 'id' not in payload:
        return {'detail': 'No order data in payload'}

    # The webhook payload is normally the COMPLETE order (line_items + billing).
    # Only call back to the WooCommerce API when it's a slim payload missing the
    # line items — so a 1000-order burst doesn't trigger 1000 extra round-trips.
    if not payload.get('line_items'):
        full = _fetch_full_wc_order(sales_channel, payload.get('id'))
        if full:
            payload = full

    wc_status = (payload.get('status') or '').lower()
    if wc_status != WC_IMPORT_STATUS:
        logger.info(
            "WooCommerce order WC#%s received via webhook but NOT imported — its "
            "status is '%s' (only '%s' orders are imported).",
            payload.get('id'), wc_status or 'unknown', WC_IMPORT_STATUS,
        )
        return {'detail': f'Order ignored until {WC_IMPORT_STATUS}', 'status': wc_status or None}

    ingestion = OrderIngestionService()  # fresh instance — no cross-call product cache
    try:
        order, created = ingestion.ingest(
            payload=payload,
            sales_channel=sales_channel,
            source=Order.Source.WOOCOMMERCE,
        )
        action = 'created' if created else 'updated'
        logger.info(
            "WooCommerce order WC#%s %s via webhook → local order %s",
            payload.get('id'), action, order.order_number,
        )

        # New orders are notified by the post_save 'created' signal. An EXISTING
        # order that arrives/updates via webhook (created=False) would otherwise be
        # silent, so notify the team explicitly here.
        if not created:
            try:
                from apps.notifications.services import NotificationService
                NotificationService.order_imported(order)
            except Exception:
                logger.exception(
                    "order_imported notification failed for webhook order %s",
                    getattr(order, 'pk', None),
                )

        _maybe_enqueue_delivery(order)

        return {
            'detail':       f'Order {action} successfully',
            'order_id':     order.id,
            'order_number': order.order_number,
            'action':       action,
        }
    except OrderIngestionError as exc:
        logger.warning("OrderIngestionError in webhook: %s | %s", exc.message, exc.details)
        return {'detail': f'Ingestion error: {exc.message}'}
    except Exception as exc:
        logger.exception("Unexpected error ingesting order: %s", exc)
        return {'detail': f'Error: {exc}'}


def soft_delete_wc_order(sales_channel, payload: dict) -> dict:
    """order.deleted — soft-delete the local order (kept for audit/financials)."""
    wc_id = str((payload or {}).get('id', ''))
    if not wc_id:
        return {'detail': 'No order ID in deletion payload'}
    company = sales_channel.brand.company
    try:
        order = Order.all_objects.get(company=company, external_order_id=wc_id)
        if not order.is_deleted:
            order.soft_delete(reason='Deleted in WooCommerce via webhook')
        return {'detail': 'Order soft-deleted', 'order_id': order.id}
    except Order.DoesNotExist:
        return {'detail': f'Order WC#{wc_id} not found locally — no action needed'}


def restore_wc_order(sales_channel, payload: dict) -> dict:
    """order.restored — restore a soft-deleted order, or ingest if unknown."""
    wc_id = str((payload or {}).get('id', ''))
    if not wc_id:
        return {'detail': 'No order ID in restore payload'}
    company = sales_channel.brand.company
    try:
        order = Order.all_objects.get(company=company, external_order_id=wc_id)
        if order.is_deleted:
            order.restore()
        return {'detail': 'Order restored', 'order_id': order.id}
    except Order.DoesNotExist:
        return ingest_wc_order(sales_channel, payload)


def dispatch_wc_order_webhook(sales_channel, payload: dict, topic: str) -> dict:
    """Route an already signature-validated WooCommerce order webhook to the right
    handler. Called by the Celery task and by the inline fallback."""
    if topic in ('order.created', 'order.updated'):
        return ingest_wc_order(sales_channel, payload)
    if topic == 'order.deleted':
        return soft_delete_wc_order(sales_channel, payload)
    if topic == 'order.restored':
        return restore_wc_order(sales_channel, payload)
    return {'detail': f'Unhandled topic {topic}'}


# ═════════════════════════════════════════════════════════════════════════════
# Registration — handlers ENQUEUE to Celery and return immediately
# ═════════════════════════════════════════════════════════════════════════════

def register_webhook_handlers():
    """Register order webhook handlers. Called from OrdersConfig.ready()."""
    try:
        from core.webhooks import webhook_registry
        from core.webhooks.validators import WebhookContext

        def _enqueue(context: WebhookContext, topic: str) -> dict:
            """Push the heavy work onto Celery so the webhook responds in
            milliseconds even under a flood of events. Falls back to inline
            processing if the broker can't be reached."""
            try:
                from apps.orders.tasks import process_wc_order_webhook
                async_result = process_wc_order_webhook.delay(
                    sales_channel_id=context.sales_channel.id,
                    payload=context.payload,
                    topic=topic,
                )
                return {
                    'detail': 'Order webhook queued',
                    'topic': topic,
                    'task_id': getattr(async_result, 'id', None),
                }
            except Exception as exc:
                logger.warning(
                    "Could not enqueue webhook task (%s) — processing inline.", exc,
                )
                return dispatch_wc_order_webhook(context.sales_channel, context.payload, topic)

        def handle_order_upsert(context: WebhookContext) -> dict:
            return _enqueue(context, getattr(context, 'topic', None) or 'order.created')

        def handle_order_deleted(context: WebhookContext) -> dict:
            return _enqueue(context, 'order.deleted')

        def handle_order_restored(context: WebhookContext) -> dict:
            return _enqueue(context, 'order.restored')

        webhook_registry.register_handler(
            handler=handle_order_upsert,
            topics=['order.created', 'order.updated'],
            name='OrderIngestionHandler',
            description='Queue WooCommerce order ingestion to Celery (fast webhook response)',
        )
        webhook_registry.register_handler(
            handler=handle_order_deleted,
            topics=['order.deleted'],
            name='OrderDeletionHandler',
            description='Queue soft-delete of an order deleted in WooCommerce',
        )
        webhook_registry.register_handler(
            handler=handle_order_restored,
            topics=['order.restored'],
            name='OrderRestoreHandler',
            description='Queue restore of an order restored in WooCommerce',
        )

        logger.info("Order webhook handlers registered (async via Celery: upsert, delete, restore)")

    except Exception as exc:
        logger.error("Failed to register order webhook handlers: %s", exc)


# ═════════════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════════════

def _fetch_full_wc_order(sales_channel, wc_order_id):
    """Fetch one complete order from the WooCommerce REST API — the same
    authoritative source the manual *Sync* uses (full client + product data).

    Returns the order dict, or ``None`` when it can't be fetched (the channel has
    no API credentials, or a network / HTTP error) so the caller can fall back to
    the webhook's own payload. Never raises.
    """
    if not wc_order_id:
        return None
    url    = getattr(sales_channel, 'wc_store_url', '') or ''
    key    = getattr(sales_channel, 'wc_consumer_key', '') or ''
    secret = getattr(sales_channel, 'wc_consumer_secret', '') or ''
    if not (url and key and secret):
        logger.info(
            "Channel %s has no WooCommerce API credentials — using the webhook "
            "payload as-is for order %s.", getattr(sales_channel, 'id', '?'), wc_order_id,
        )
        return None
    try:
        from woocommerce import API as WooCommerceAPI
        client = WooCommerceAPI(
            url=url, consumer_key=key, consumer_secret=secret,
            version='wc/v3', timeout=WC_API_TIMEOUT_SECONDS,
        )
        resp = client.get(f'orders/{wc_order_id}')
        if resp.status_code >= 400:
            logger.warning(
                "WC API fetch for order %s returned HTTP %s — using webhook payload instead.",
                wc_order_id, resp.status_code,
            )
            return None
        data = resp.json()
        if isinstance(data, dict) and data.get('id'):
            return data
        return None
    except Exception as exc:  # network / auth / JSON — must never break the webhook
        logger.warning(
            "Could not fetch order %s from the WC API (%s) — using webhook payload instead.",
            wc_order_id, exc,
        )
        return None


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

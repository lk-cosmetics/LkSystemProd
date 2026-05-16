"""
LkSystem Orders App - Celery Tasks
═══════════════════════════════════════════════════════════════════════════════
Background tasks for order syncing and delivery submission.

All tasks are designed to be:
  • Idempotent  — safe to retry without side effects
  • Bounded     — have a clear timeout
  • Observable  — log start/end and record results in OrderSyncEvent

Celery is OPTIONAL. If not installed/configured, tasks degrade gracefully:
  • sync_orders_for_channel() can be called directly as a plain function
  • The views fall back to synchronous execution when Celery is unavailable

Required Django settings when Celery IS enabled:
    CELERY_BROKER_URL  = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND = "redis://localhost:6379/1"
"""

import logging
from datetime import timedelta
from typing import Optional

from django.utils import timezone

logger = logging.getLogger(__name__)

# ─── Module-level constants ────────────────────────────────────────────────────
MAX_DELIVERY_ATTEMPTS = 3
WC_IMPORT_STATUS = 'processing'
WC_PAGE_SIZE = 100
SYNC_OVERLAP_MINUTES = 5


# ─── Celery app — lazy import so Django works without Celery installed ─────────

def _get_celery_app():
    try:
        from core.celery import app
        return app
    except ImportError:
        return None


celery_app = _get_celery_app()


def _task(bind=False, **kwargs):
    """Decorator factory: returns a real @celery_app.task or a no-op decorator."""
    def decorator(func):
        if celery_app is not None:
            return celery_app.task(bind=bind, **kwargs)(func)
        func.delay = lambda *a, **kw: func(*a, **kw)
        func.apply_async = lambda args=(), kwargs={}, **opts: func(*args, **kwargs)
        return func
    return decorator


# ═════════════════════════════════════════════════════════════════════════════
# SYNC TASK
# ═════════════════════════════════════════════════════════════════════════════

@_task(
    bind=True,
    name='orders.sync_orders_for_channel',
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
)
def sync_orders_for_channel(
    self,
    sales_channel_id: int,
    incremental: bool = True,
    triggered_by_user_id: Optional[int] = None,
    max_orders: Optional[int] = None,
    event_id: Optional[int] = None,
):
    """
    Pull new/changed PROCESSING WooCommerce orders for a single sales channel.

    Production-ready implementation with:
      - Fetch ONLY status='processing' (new website order business rule)
      - Single WooCommerce request stream (no status loop)
      - WooCommerce-supported `after` param for true incremental sync
      - Deduplicate by WooCommerce order id (idempotent)
      - Proper pagination with stop conditions (per_page=100, page-based)
      - 5-minute time overlap to catch edge-case updates
      - Celery retry integration with graceful fallback
    """
    from woocommerce import API as WooCommerceAPI
    from requests import exceptions as req_exc

    from apps.orders.models import Order, OrderSyncEvent
    from apps.orders.service import OrderIngestionService
    from apps.sales_channels.models import SalesChannel

    try:
        channel = SalesChannel.objects.select_related('brand__company').get(
            pk=sales_channel_id,
            channel_type='WOOCOMMERCE',
            is_active=True,
        )
    except SalesChannel.DoesNotExist:
        logger.error("sync_orders_for_channel: channel %s not found or inactive", sales_channel_id)
        return {'error': f'Channel {sales_channel_id} not found'}

    triggered_by = None
    if triggered_by_user_id:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        triggered_by = User.objects.filter(pk=triggered_by_user_id).first()

    sync_to = timezone.now()
    statuses = [WC_IMPORT_STATUS]
    event = None

    if event_id:
        event = OrderSyncEvent.objects.filter(
            pk=event_id,
            sales_channel=channel,
        ).first()

    sync_from = event.sync_from if event else None

    if incremental and sync_from is None:
        last_ok = (
            OrderSyncEvent.objects
            .filter(
                sales_channel=channel,
                status__in=[
                    OrderSyncEvent.SyncStatus.COMPLETED,
                    OrderSyncEvent.SyncStatus.PARTIAL,
                ],
            )
            .order_by('-finished_at')
            .values_list('finished_at', flat=True)
            .first()
        )
        if last_ok:
            sync_from = last_ok - timedelta(minutes=SYNC_OVERLAP_MINUTES)
            logger.info(
                "Incremental processing-orders sync for channel=%s modified-after(after)=%s",
                channel.name,
                sync_from.isoformat(),
            )
        else:
            latest_wc_timestamp = (
                Order.all_objects
                .filter(
                    sales_channel=channel,
                    source=Order.Source.WOOCOMMERCE,
                    wc_status=WC_IMPORT_STATUS,
                    wc_date_modified__isnull=False,
                )
                .order_by('-wc_date_modified')
                .values_list('wc_date_modified', flat=True)
                .first()
            )
            if latest_wc_timestamp is None:
                latest_wc_timestamp = (
                    Order.all_objects
                    .filter(
                        sales_channel=channel,
                        source=Order.Source.WOOCOMMERCE,
                        wc_status=WC_IMPORT_STATUS,
                        wc_date_created__isnull=False,
                    )
                    .order_by('-wc_date_created')
                    .values_list('wc_date_created', flat=True)
                    .first()
                )
            if latest_wc_timestamp:
                sync_from = latest_wc_timestamp - timedelta(minutes=SYNC_OVERLAP_MINUTES)
                logger.info(
                    "Incremental processing-orders sync for channel=%s local-last(after)=%s",
                    channel.name,
                    sync_from.isoformat(),
                )

    if event is None:
        event = OrderSyncEvent.objects.create(
            sales_channel=channel,
            company=channel.brand.company,
            triggered_by=triggered_by,
            trigger_source=OrderSyncEvent.TriggerSource.CELERY,
            status=OrderSyncEvent.SyncStatus.RUNNING,
            sync_from=sync_from,
            sync_to=sync_to,
            wc_statuses_synced=statuses,
        )
    else:
        event.triggered_by = event.triggered_by or triggered_by
        event.status = OrderSyncEvent.SyncStatus.RUNNING
        event.sync_from = sync_from
        event.sync_to = sync_to
        event.wc_statuses_synced = statuses
        event.save(update_fields=[
            'triggered_by', 'status', 'sync_from', 'sync_to',
            'wc_statuses_synced',
        ])

    wc_api = WooCommerceAPI(
        url=channel.wc_store_url,
        consumer_key=channel.wc_consumer_key,
        consumer_secret=channel.wc_consumer_secret,
        version='wc/v3',
        timeout=15,
    )

    all_wc_orders = []
    seen_wc_ids = set()

    try:
        params = {
            'per_page': WC_PAGE_SIZE,
            'orderby': 'date',
            'order': 'desc',
            'status': WC_IMPORT_STATUS,
        }
        if sync_from:
            params['after'] = sync_from.isoformat()

        logger.info(
            "WooCommerce orders sync request channel=%s params=%s",
            channel.name,
            params,
        )

        page = 1
        while True:
            page_params = {**params, 'page': page}
            try:
                resp = wc_api.get('orders', params=page_params)
            except req_exc.Timeout:
                raise
            except req_exc.RequestException as exc:
                raise ConnectionError(
                    f"WooCommerce request failed at page {page}: {exc}"
                ) from exc

            if resp.status_code >= 400:
                raise Exception(f"WC API error {resp.status_code}: {resp.text[:300]}")

            batch = resp.json()
            if not batch:
                break

            for wc_order in batch:
                wc_id = wc_order.get('id')
                if wc_id in seen_wc_ids:
                    continue
                seen_wc_ids.add(wc_id)
                all_wc_orders.append(wc_order)

                if max_orders and len(all_wc_orders) >= max_orders:
                    break

            logger.info(
                "Fetched page=%s channel=%s batch=%s accumulated=%s",
                page,
                channel.name,
                len(batch),
                len(all_wc_orders),
            )

            if max_orders and len(all_wc_orders) >= max_orders:
                break
            if len(batch) < WC_PAGE_SIZE:
                break

            total_pages = int(resp.headers.get('X-WP-TotalPages', '0') or 0)
            if total_pages and page >= total_pages:
                break

            page += 1

    except Exception as exc:
        logger.error("Failed to fetch processing orders for channel %s: %s", channel.name, exc)
        event.finish(
            created=0,
            updated=0,
            errors=1,
            error_detail=[{'wc_id': None, 'error': str(exc)}],
            status=OrderSyncEvent.SyncStatus.FAILED,
        )
        if celery_app is not None:
            try:
                raise self.retry(exc=exc)
            except Exception:
                pass
        return {'error': str(exc)}

    event.fetched_count = len(all_wc_orders)
    event.save(update_fields=['fetched_count'])

    created, updated, errors, error_details = OrderIngestionService.bulk_sync(
        wc_orders=all_wc_orders,
        sales_channel=channel,
        source=Order.Source.WOOCOMMERCE,
        created_by=triggered_by,
        sync_event=event,
    )

    event.finish(
        created=created,
        updated=updated,
        errors=errors,
        error_detail=error_details,
    )

    logger.info(
        "Processing orders sync done for channel=%s fetched=%d created=%d updated=%d errors=%d",
        channel.name,
        len(all_wc_orders),
        created,
        updated,
        errors,
    )
    return {
        'channel': channel.id,
        'fetched': len(all_wc_orders),
        'created': created,
        'updated': updated,
        'errors': errors,
        'event_id': event.id,
        'statuses': statuses,
    }


# ═════════════════════════════════════════════════════════════════════════════
# DELIVERY SUBMISSION TASK
# ═════════════════════════════════════════════════════════════════════════════

@_task(
    bind=True,
    name='orders.submit_order_to_delivery',
    max_retries=MAX_DELIVERY_ATTEMPTS,
    default_retry_delay=300,
    soft_time_limit=60,
    time_limit=75,
    acks_late=True,
)
def submit_order_to_delivery(self, order_id: int, actor_user_id: Optional[int] = None):
    """
    Submit a single order to the external delivery provider.

    Retries up to MAX_DELIVERY_ATTEMPTS times with exponential back-off.
    On final failure the order delivery_status is set to FAILED so the
    operator can review and manually retry.
    """
    from apps.orders.models import Order
    from apps.orders.delivery_service import DeliverySubmissionService, DeliveryError

    try:
        order = Order.objects.select_related('sales_channel__brand__company').get(pk=order_id)
    except Order.DoesNotExist:
        logger.error("submit_order_to_delivery: order %s not found", order_id)
        return {'error': f'Order {order_id} not found'}

    actor = None
    if actor_user_id:
        from django.contrib.auth import get_user_model
        actor = get_user_model().objects.filter(pk=actor_user_id).first()

    service = DeliverySubmissionService()
    try:
        result = service.submit(order, actor=actor)
        return {'order_id': order_id, 'result': result}

    except DeliveryError as exc:
        logger.warning(
            "Delivery submission failed for order %s (attempt %d/%d): %s",
            order_id, self.request.retries + 1, MAX_DELIVERY_ATTEMPTS, exc.message,
        )
        if celery_app is not None:
            try:
                countdown = 300 * (5 ** self.request.retries)
                raise self.retry(exc=exc, countdown=countdown)
            except Exception:
                pass
        return {'order_id': order_id, 'error': exc.message}


# ═════════════════════════════════════════════════════════════════════════════
# PERIODIC: retry all FAILED deliveries
# ═════════════════════════════════════════════════════════════════════════════

@_task(
    name='orders.retry_failed_deliveries',
    soft_time_limit=120,
    time_limit=150,
)
def retry_failed_deliveries():
    from apps.orders.models import Order

    eligible = Order.objects.filter(
        delivery_status=Order.DeliveryStatus.FAILED,
        delivery_attempts__lt=MAX_DELIVERY_ATTEMPTS,
        is_deleted=False,
    ).values_list('id', flat=True)[:50]

    queued = 0
    for order_id in eligible:
        submit_order_to_delivery.delay(order_id)
        queued += 1

    logger.info("retry_failed_deliveries: queued %d orders for retry", queued)
    return {'queued': queued}


# ═════════════════════════════════════════════════════════════════════════════
# PERIODIC: incremental sync for all active WooCommerce channels
# ═════════════════════════════════════════════════════════════════════════════

@_task(
    name='orders.sync_all_channels',
    soft_time_limit=30,
    time_limit=45,
)
def sync_all_channels():
    from apps.sales_channels.models import SalesChannel

    channels = SalesChannel.objects.filter(
        channel_type='WOOCOMMERCE',
        is_active=True,
    ).values_list('id', flat=True)

    for channel_id in channels:
        sync_orders_for_channel.delay(
            sales_channel_id=channel_id,
            incremental=True,
        )

    logger.info("sync_all_channels: enqueued %d channel syncs", len(channels))
    return {'channels_enqueued': len(channels)}

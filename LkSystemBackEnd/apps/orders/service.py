"""
LkSystem Orders App - OrderIngestionService
═══════════════════════════════════════════════════════════════════════════════
Unified service that ingests orders from **both** sources:

  * Method A – WooCommerce REST API poll / webhooks
  * Method B – Manual / POS entry (cashier UI → JSON → same pipeline)

Both paths converge inside `ingest()`, which:
  1.  Validates the payload structure
  2.  Performs an **idempotency check** (external_order_id + company)
  3.  Auto-registers the client if billing_email is unknown
  4.  Creates / updates the Order + OrderLine rows
  5.  Stores raw WooCommerce payload + metadata
  6.  Reconciles inventory movements for completed/cancelled orders

v2 fixes:
  • Cross-channel cache pollution: caches are now keyed by (channel_id, wc_pid)
    so products from different stores never collide.
  • Incremental sync: bulk_sync() accepts optional modified_after datetime.
  • All-status sync: statuses list is passed in, not hardcoded to 'processing'.
  • Raw payload stored on Order.raw_wc_payload for replay / debugging.
  • WooCommerce meta_data array indexed into Order.wc_meta_data dict.
  • OrderSyncEvent created and finished around every bulk_sync() call.

Every database query is scoped by `company` (tenant_id).
"""

import logging
import uuid
import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, Dict, Any, Tuple, List

from django.db import models, transaction, IntegrityError
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.clients.models import Client
from apps.clients.utils import normalize_tunisian_phone
from apps.company.models import Company
from apps.inventory.models import SalesChannelInventory, InventoryMovement
from apps.orders.models import Order, OrderLine, OrderLog, OrderSyncEvent
from apps.products.models import Product
from apps.products.product_sync_service import ProductSyncService
from apps.sales_channels.models import SalesChannel

logger = logging.getLogger(__name__)


# ─── exceptions ──────────────────────────────────────────────────────────────

class OrderIngestionError(Exception):
    def __init__(self, message: str, details: dict = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)


# ─── WooCommerce status sets ──────────────────────────────────────────────────

# Only new/active website orders are synced into the system by default.
WC_ALL_SYNCABLE_STATUSES = ['processing']

# Statuses that should reserve/deduct finished product stock.
WC_MOVEMENT_STATUSES = {Order.Status.COMPLETED}


# ═════════════════════════════════════════════════════════════════════════════
# OrderIngestionService
# ═════════════════════════════════════════════════════════════════════════════

class OrderIngestionService:
    """
    Stateless service — instantiate **once per bulk_sync call** or
    **once per webhook request** (never share instances across requests).

    IMPORTANT: The per-instance caches (_product_cache, _client_cache,
    _existing_order_ids) are scoped to a single (channel, run) pair.
    Sharing an instance across channels or across HTTP requests causes
    cross-channel data contamination.
    """

    def __init__(self):
        # Cache key: (channel_id, wc_pid) → Product | None
        # Scoped to channel so products from different stores never collide.
        self._product_cache: Dict[Tuple[int, Any], Optional[Product]] = {}
        self._client_cache: Dict[str, Optional[Client]] = {}   # email → Client
        self._existing_order_ids: Optional[set] = None         # pre-fetched ext IDs
        self._existing_orders: Dict[str, Order] = {}           # ext ID → Order

    # ─── bulk entry point ─────────────────────────────────────────────────────

    @classmethod
    def bulk_sync(
        cls,
        wc_orders: List[Dict[str, Any]],
        sales_channel: SalesChannel,
        source: str = Order.Source.WOOCOMMERCE,
        created_by=None,
        sync_event: Optional[OrderSyncEvent] = None,
    ) -> Tuple[int, int, int, list]:
        """
        Sync a list of WooCommerce order dicts efficiently.

        Pre-fetches products, existing orders, and inventory in bulk so that
        the per-order loop only does writes — not reads.

        Returns:
            (created, updated, errors, error_details)

        The caller is responsible for creating and finishing the OrderSyncEvent.
        Pass it in so the service can record per-order errors against it.
        """
        company: Company = sales_channel.brand.company
        instance = cls()

        # ── 1. Pre-fetch existing order IDs (1 query) ─────────────────────
        all_external_ids = [str(o.get('id', '')) for o in wc_orders if o.get('id')]
        existing_orders = Order.all_objects.filter(
            company=company,
            sales_channel=sales_channel,
            external_order_id__in=all_external_ids,
        )
        instance._existing_orders = {
            order.external_order_id: order
            for order in existing_orders
        }
        instance._existing_order_ids = set(instance._existing_orders)

        # ── 2. Pre-fetch products by wc_product_id for this channel (1 query)
        wc_pids = set()
        for o in wc_orders:
            for li in o.get('line_items', []):
                pid = li.get('product_id') or li.get('wc_product_id')
                if pid:
                    wc_pids.add(pid)

        instance._product_cache = {
            (sales_channel.id, p.wc_product_id): p
            for p in Product.objects.filter(
                sales_channel_inventories__sales_channel=sales_channel,
                wc_product_id__in=wc_pids,
            ).distinct()
        }

        # ── 3. Pre-fetch existing clients by email (1 query) ───────────────
        emails = set()
        for o in wc_orders:
            email = (o.get('billing', {}).get('email') or '').strip().lower()
            if email:
                emails.add(email)
        instance._client_cache = {
            c.email: c
            for c in Client.objects.filter(company=company, email__in=emails)
        }

        # ── 4. Process orders ──────────────────────────────────────────────
        created = updated = errors = 0
        error_details: list = []

        for wc_order in wc_orders:
            try:
                _, is_new = instance.ingest(
                    payload=wc_order,
                    sales_channel=sales_channel,
                    source=source,
                    created_by=created_by,
                )
                if is_new:
                    created += 1
                else:
                    updated += 1
            except Exception as exc:
                errors += 1
                wc_id = wc_order.get('id', 'unknown')
                error_msg = str(exc)
                logger.error(
                    "Bulk sync order WC#%s failed: %s", wc_id, error_msg,
                )
                error_details.append({'wc_id': wc_id, 'error': error_msg})

        return created, updated, errors, error_details

    # ─── public entry point ────────────────────────────────────────────────────

    @transaction.atomic
    def ingest(
        self,
        payload: Dict[str, Any],
        sales_channel: SalesChannel,
        source: str = Order.Source.WOOCOMMERCE,
        created_by=None,
    ) -> Tuple[Order, bool]:
        """
        Unified ingestion entry-point for a single order.

        Returns:
            (order, created): The Order row + whether it was newly created.

        Raises:
            OrderIngestionError on validation / processing failures.
        """
        company: Company = sales_channel.brand.company

        # 1. validate
        self._validate_payload(payload)

        # 2. idempotency — WC ID, order_key, then stable fallback hash
        external_id = str(payload.get('id', '') or payload.get('external_order_id', ''))
        wc_order_key = payload.get('order_key', '')
        ticket_id = str(payload.get('ticket_id', '') or '').strip()
        client_ticket_uuid = str(payload.get('client_ticket_uuid', '') or '').strip()
        import_hash = self._stable_import_hash(payload, sales_channel)
        order, is_new = self._idempotency_check(
            external_id, wc_order_key, import_hash, company, sales_channel,
            ticket_id=ticket_id,
            client_ticket_uuid=client_ticket_uuid,
        )

        if source == Order.Source.POS and is_new:
            ticket_id = self._resolve_pos_ticket_id(
                company=company,
                requested_ticket_id=ticket_id,
                client_ticket_uuid=client_ticket_uuid,
            )

        # Track original status for tracking WooCommerce order completion
        original_status = order.status if not is_new else None

        # 3. client auto-registration
        billing = payload.get('billing', {})
        client  = self._resolve_or_create_client(billing, company, sales_channel, source)

        # 4. map header fields
        order = self._map_order_fields(
            order=order,
            payload=payload,
            company=company,
            sales_channel=sales_channel,
            client=client,
            source=source,
            external_id=external_id,
            wc_order_key=wc_order_key,
            ticket_id=ticket_id,
            client_ticket_uuid=client_ticket_uuid,
            import_hash=import_hash,
            created_by=created_by,
        )
        order._actor = created_by
        try:
            order.save()
        except IntegrityError:
            # Concurrent webhook/manual sync may have inserted the same order
            # after our first lookup. Re-lock and update that row instead of
            # surfacing a duplicate-key failure.
            try:
                order = self._fetch_existing_after_integrity(
                    company, sales_channel, external_id, wc_order_key, import_hash,
                    ticket_id=ticket_id,
                    client_ticket_uuid=client_ticket_uuid,
                )
                is_new = False
            except Order.DoesNotExist:
                if source != Order.Source.POS or not client_ticket_uuid:
                    raise
                ticket_id = self._next_pos_ticket_id(company)
                order = Order()

            order = self._map_order_fields(
                order=order,
                payload=payload,
                company=company,
                sales_channel=sales_channel,
                client=client,
                source=source,
                external_id=external_id,
                wc_order_key=wc_order_key,
                ticket_id=ticket_id,
                client_ticket_uuid=client_ticket_uuid,
                import_hash=import_hash,
                created_by=created_by,
            )
            order._actor = created_by
            order.save()

        # 5. upsert line items
        lines = self._upsert_lines(order, payload.get('line_items', []), sales_channel)

        # 6. recalculate totals from lines
        self._recalc_totals(order, payload, lines)
        order.save(update_fields=[
            'subtotal', 'tax_total', 'discount_total', 'total', 'updated_at',
        ])

        # 7. reconcile inventory movements for order status/line changes
        self._sync_inventory_movements(order, lines, sales_channel, created_by)

        # 8. increment client's order count
        # - For new orders (any source): always increment
        # - For WooCommerce updates: increment if status changed to COMPLETED
        should_increment = (
            (is_new and client) or 
            (not is_new and client and source == Order.Source.WOOCOMMERCE 
             and original_status != Order.Status.COMPLETED 
             and order.status == Order.Status.COMPLETED)
        )
        
        if should_increment:
            client.number_of_orders = (client.number_of_orders or 0) + 1
            client.save(update_fields=['number_of_orders', 'updated_at'])
            logger.info(
                "Client order count updated: client=%s now has %d orders",
                client.id, client.number_of_orders
            )

        action = 'created' if is_new else 'updated'
        logger.info(
            "Order %s %s (%s) via %s [company=%s]",
            order.order_number, action, order.status, source, company.id,
        )
        return order, is_new

    # ─── validation ───────────────────────────────────────────────────────────

    @staticmethod
    def _validate_payload(payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise OrderIngestionError("Payload must be a JSON object.")
        if not payload.get('line_items'):
            raise OrderIngestionError("Order must contain at least one line_item.")

    # ─── idempotency ──────────────────────────────────────────────────────────

    def _idempotency_check(
        self,
        external_id: str,
        wc_order_key: str,
        import_hash: str,
        company: Company,
        sales_channel: SalesChannel,
        *,
        ticket_id: str = '',
        client_ticket_uuid: str = '',
    ) -> Tuple[Order, bool]:
        """
        Return (order, is_new).

        Lookup order:
          1. By external_id (WC numeric ID) — primary key
          2. By wc_order_key — fallback for edge cases

        In bulk_sync mode uses the pre-fetched ID set for O(1) lookup;
        otherwise falls back to a DB query.
        """
        if not external_id and not wc_order_key and not import_hash and not ticket_id and not client_ticket_uuid:
            return Order(), True

        if client_ticket_uuid:
            try:
                existing = Order.all_objects.select_for_update().get(
                    company=company,
                    client_ticket_uuid=client_ticket_uuid,
                )
                return existing, False
            except Order.DoesNotExist:
                pass

        if ticket_id and not client_ticket_uuid:
            try:
                existing = Order.all_objects.select_for_update().get(
                    company=company,
                    ticket_id=ticket_id,
                )
                return existing, False
            except Order.DoesNotExist:
                pass

        # Fast path — bulk mode
        if self._existing_order_ids is not None and external_id:
            if external_id in self._existing_order_ids:
                existing = self._existing_orders.get(external_id)
                if existing is not None:
                    locked = Order.all_objects.select_for_update().get(pk=existing.pk)
                    return locked, False
            return Order(), True

        # Slow path — single-order / webhook mode
        if external_id:
            try:
                existing = Order.all_objects.select_for_update().get(
                    company=company,
                    sales_channel=sales_channel,
                    external_order_id=external_id,
                )
                return existing, False
            except Order.DoesNotExist:
                pass

        # Final fallback: match by order_key
        if wc_order_key:
            try:
                existing = Order.all_objects.select_for_update().get(
                    company=company,
                    sales_channel=sales_channel,
                    wc_order_key=wc_order_key,
                )
                return existing, False
            except Order.DoesNotExist:
                pass

        if import_hash:
            try:
                existing = Order.all_objects.select_for_update().get(
                    company=company,
                    sales_channel=sales_channel,
                    import_hash=import_hash,
                )
                return existing, False
            except Order.DoesNotExist:
                pass

        return Order(), True

    @staticmethod
    def _ticket_prefix() -> str:
        return timezone.localdate().strftime('%d%m%Y')

    @classmethod
    def _next_pos_ticket_id(cls, company: Company) -> str:
        Company.objects.select_for_update().get(pk=company.pk)
        prefix = cls._ticket_prefix()
        latest = (
            Order.all_objects
            .filter(company=company, source=Order.Source.POS, ticket_id__startswith=prefix)
            .order_by('-ticket_id')
            .values_list('ticket_id', flat=True)
            .first()
        )
        next_number = 1
        if latest and len(latest) >= len(prefix) + 4:
            try:
                next_number = int(latest[len(prefix):]) + 1
            except ValueError:
                next_number = 1

        while True:
            candidate = f'{prefix}{next_number:04d}'
            if not Order.all_objects.filter(company=company, ticket_id=candidate).exists():
                return candidate
            next_number += 1

    @classmethod
    def _resolve_pos_ticket_id(
        cls,
        *,
        company: Company,
        requested_ticket_id: str,
        client_ticket_uuid: str,
    ) -> str:
        """
        POS tickets use a short daily sequence: DDMMYYYY0001.

        Offline tills may generate a local number before syncing. If that number
        already belongs to a different ticket, keep the client UUID as the
        idempotency key and assign the next safe daily ticket number.
        """
        if not requested_ticket_id:
            return cls._next_pos_ticket_id(company)

        conflict = (
            Order.all_objects
            .filter(company=company, ticket_id=requested_ticket_id)
            .exclude(client_ticket_uuid=client_ticket_uuid or '')
            .exists()
        )
        if conflict and client_ticket_uuid:
            return cls._next_pos_ticket_id(company)
        return requested_ticket_id

    @staticmethod
    def _fetch_existing_after_integrity(
        company: Company,
        sales_channel: SalesChannel,
        external_id: str,
        wc_order_key: str,
        import_hash: str,
        *,
        ticket_id: str = '',
        client_ticket_uuid: str = '',
    ) -> Order:
        filters = Q(company=company)
        match = Q()
        if external_id:
            match |= Q(sales_channel=sales_channel, external_order_id=external_id)
        if wc_order_key:
            match |= Q(sales_channel=sales_channel, wc_order_key=wc_order_key)
        if import_hash:
            match |= Q(sales_channel=sales_channel, import_hash=import_hash)
        if client_ticket_uuid:
            match |= Q(client_ticket_uuid=client_ticket_uuid)
        if ticket_id and not client_ticket_uuid:
            match |= Q(ticket_id=ticket_id)
        if not match:
            raise OrderIngestionError('Duplicate order detected but no idempotency key was available.')
        return Order.all_objects.select_for_update().get(filters & match)

    # ─── client auto-registration ─────────────────────────────────────────────

    @staticmethod
    def _map_client_source(source: str) -> str:
        source_map = {
            Order.Source.WOOCOMMERCE: Client.Source.WOOCOMMERCE,
            Order.Source.POS:         Client.Source.POS,
        }
        return source_map.get(source, Client.Source.MANUAL)

    def _resolve_or_create_client(
        self,
        billing: Dict[str, Any],
        company: Company,
        sales_channel: SalesChannel,
        source: str,
    ) -> Optional[Client]:
        # Local import avoids any import cycle with delivery_service.
        from apps.orders.delivery_service import canonical_governorate_name
        email = (billing.get('email') or '').strip().lower() or None
        phone = (billing.get('phone') or '').strip() or None
        phone_normalized = normalize_tunisian_phone(phone)

        if not email and not phone:
            return None

        # In-memory cache (keyed by email, scoped to this instance/run)
        if email and email in self._client_cache:
            return self._client_cache[email]

        # DB lookup — email first, phone fallback
        client = None
        if email:
            client = Client.objects.filter(company=company, email=email).first()
        if client is None and phone_normalized:
            client = Client.objects.filter(company=company, phone_normalized=phone_normalized).first()

        if client is not None:
            wc_cid = billing.get('customer_id')
            update_fields = []
            if wc_cid and not client.wc_customer_id:
                client.wc_customer_id = wc_cid
                update_fields.append('wc_customer_id')
            for field, value in {
                'first_name': billing.get('first_name', ''),
                'last_name': billing.get('last_name', ''),
                'phone': phone,
                'address': billing.get('address_1', ''),
                'state': canonical_governorate_name(billing.get('state', '')),
                'postcode': billing.get('postcode', ''),
                'country': billing.get('country', 'TN'),
            }.items():
                if value and not getattr(client, field):
                    setattr(client, field, value)
                    update_fields.append(field)
            # Backfill the brand from the order's sales channel when missing —
            # WooCommerce-imported clients previously had no brand attributed.
            if getattr(sales_channel, 'brand_id', None) and not client.brand_id:
                client.brand = sales_channel.brand
                update_fields.append('brand')
            if update_fields:
                client.save(update_fields=[*update_fields, 'phone_normalized', 'updated_at'])
            if email:
                self._client_cache[email] = client
            return client

        # Create — guard against concurrent duplicate inserts
        defaults = {
            'first_name':    billing.get('first_name', ''),
            'last_name':     billing.get('last_name', ''),
            'phone':         phone,
            'address':       billing.get('address_1', ''),
            'city':          '',
            'state':         canonical_governorate_name(billing.get('state', '')),
            'postcode':      billing.get('postcode', ''),
            'country':       billing.get('country', 'TN'),
            'source':        OrderIngestionService._map_client_source(source),
            'sales_channel': sales_channel,
            # Attribute the client to the order's brand (was previously unset
            # for WooCommerce imports).
            'brand':         sales_channel.brand,
        }
        
        # ─── Generate default email if missing ────────────────────────────────
        if not email:
            email = self._generate_default_email(phone, company, defaults)
        
        try:
            with transaction.atomic():
                client = Client.objects.create(
                    company=company, email=email, **defaults,
                )
            logger.info(
                "Auto-registered client email=%s phone=%s company=%s",
                email, phone, company.id,
            )
        except IntegrityError:
            # Race condition — another concurrent request won the INSERT
            client = None
            if email:
                client = Client.objects.filter(company=company, email=email).first()
            if client is None and phone_normalized:
                client = Client.objects.filter(company=company, phone_normalized=phone_normalized).first()
            if client is None:
                logger.error(
                    "IntegrityError creating client but could not find "
                    "email=%s phone=%s — re-raising", email, phone,
                )
                raise
            logger.warning(
                "Race condition resolved: found existing client %s after IntegrityError",
                client.id,
            )

        if email:
            self._client_cache[email] = client
        return client
    
    def _generate_default_email(self, phone: Optional[str], company: Company, billing_data: dict) -> str:
        """
        Generate a default email when order has no email address.
        
        Strategies:
        1. If phone exists: use phone@noemail.company.abbreviation (e.g., 97835030@noemail.test)
        2. Otherwise: use uuid@noemail.company.abbreviation
        
        Returns:
            A valid, unique email address.
        """
        company_abbr = (company.abbreviation or 'local').lower()
        
        # Strategy 1: Use phone if available
        if phone:
            clean_phone = normalize_tunisian_phone(phone)
            return f"{clean_phone}@noemail.{company_abbr}"
        
        # Strategy 2: Use UUID
        unique_id = str(uuid.uuid4())[:8]
        return f"noemail_{unique_id}@noemail.{company_abbr}"

    # ─── header mapping ───────────────────────────────────────────────────────

    def _map_order_fields(
        self,
        order: Order,
        payload: Dict[str, Any],
        company: Company,
        sales_channel: SalesChannel,
        client: Optional[Client],
        source: str,
        external_id: str,
        wc_order_key: str,
        ticket_id: str,
        client_ticket_uuid: str,
        import_hash: str,
        created_by,
    ) -> Order:
        order.company       = company
        order.sales_channel = sales_channel
        order.brand         = sales_channel.brand
        order.client        = client
        order.source        = source
        order.external_order_id = external_id
        order.wc_order_key      = wc_order_key
        if ticket_id:
            order.ticket_id = ticket_id
        if client_ticket_uuid:
            order.client_ticket_uuid = client_ticket_uuid
        order.import_hash       = import_hash

        # Status separation:
        # - wc_status is the raw WooCommerce status and is safe to update on
        #   every webhook/manual sync.
        # - status is the local operational status. Existing local decisions
        #   must not be overwritten by WooCommerce processing/completed changes.
        wc_status = (payload.get('status') or '').lower()
        is_new_order = not order.pk
        order.wc_status = wc_status
        if source == Order.Source.WOOCOMMERCE:
            if is_new_order and not order.status:
                order.status = Order.Status.PENDING
        elif wc_status:
            order.status = self._map_wc_status(wc_status)

        order.payment_method = (
            payload.get('payment_method_title', '')
            or payload.get('payment_method', '')
        )
        order.payment_status = self._map_payment_status(wc_status, payload)
        order.currency       = payload.get('currency', 'TND')

        # Billing
        billing                    = payload.get('billing', {})
        order.billing_first_name   = billing.get('first_name', '')
        order.billing_last_name    = billing.get('last_name', '')
        order.billing_company      = billing.get('company', '')
        order.billing_email        = billing.get('email', '')
        order.billing_phone        = billing.get('phone', '')
        order.billing_address_1    = billing.get('address_1', '')
        order.billing_address_2    = billing.get('address_2', '')
        order.billing_city         = billing.get('city', '')
        order.billing_state        = billing.get('state', '')
        order.billing_postcode     = billing.get('postcode', '')
        order.billing_country      = billing.get('country', 'TN')

        # Shipping
        shipping                    = payload.get('shipping', {})
        order.shipping_first_name   = shipping.get('first_name', '')
        order.shipping_last_name    = shipping.get('last_name', '')
        order.shipping_address_1    = shipping.get('address_1', '')
        order.shipping_city         = shipping.get('city', '')
        order.shipping_state        = shipping.get('state', '')
        order.shipping_postcode     = shipping.get('postcode', '')
        order.shipping_country      = shipping.get('country', 'TN')

        order.customer_note   = payload.get('customer_note', '')
        order.shipping_total  = self._dec(payload.get('shipping_total'))

        payload_discount_type  = str(payload.get('discount_type', '')).upper()
        payload_discount_value = self._dec(payload.get('discount_value'))
        if payload_discount_type in dict(Order.DiscountType.choices):
            order.discount_type  = payload_discount_type
            order.discount_value = payload_discount_value
        else:
            order.discount_type  = Order.DiscountType.NONE
            order.discount_value = Decimal('0.00')

        # WC timestamps
        order.wc_date_created  = self._parse_dt(payload.get('date_created'))
        order.wc_date_modified = self._parse_dt(payload.get('date_modified'))

        # Store the full raw payload for debugging / replay (only for WooCommerce orders)
        # For POS orders, skip storing payload as it may contain non-JSON-serializable values
        if source == Order.Source.WOOCOMMERCE:
            order.raw_wc_payload = payload
        else:
            # For POS/MANUAL orders, leave as None to avoid JSON validation errors
            order.raw_wc_payload = None

        # Index the WooCommerce meta_data array into a flat dict for fast key lookup.
        # WooCommerce returns: [{"id": 1, "key": "_call_status", "value": "ok"}, ...]
        meta_list = payload.get('meta_data') or []
        if isinstance(meta_list, list):
            order.wc_meta_data = {
                item['key']: item.get('value')
                for item in meta_list
                if isinstance(item, dict) and 'key' in item
            }

        # Mark sync timestamp
        order.synced_at = timezone.now()

        if created_by and not order.pk:
            order.created_by = created_by

        return order

    # ─── line items ───────────────────────────────────────────────────────────

    def _upsert_lines(
        self,
        order: Order,
        line_items: list,
        sales_channel: SalesChannel,
    ) -> list:
        """Upsert active lines by external line ID so re-imports do not duplicate rows."""
        seen_keys: set[str] = set()
        existing = {
            line.external_line_id: line
            for line in OrderLine.all_objects.select_for_update().filter(order=order)
            if line.external_line_id
        }
        # POS and manual sales are priced by the SERVER from the product
        # catalogue (with any active promotion applied) — the client price is
        # never trusted and a submitted price below the server price is rejected.
        # WooCommerce orders keep the price the customer was actually charged.
        server_priced = order.source in (Order.Source.POS, Order.Source.MANUAL)
        lines = []
        for position, item in enumerate(line_items):
            product   = self._resolve_product(item, sales_channel)
            qty       = max(1, int(item.get('quantity', 1)))
            tax   = self._dec(item.get('total_tax', '0'))
            if server_priced and product is not None:
                server_price = self._server_unit_price(product, sales_channel)
                submitted = (
                    self._dec(item.get('price'))
                    if item.get('price') is not None else None
                )
                if submitted is not None and submitted < server_price:
                    raise OrderIngestionError(
                        f'Price for "{product.name}" is below the allowed price.',
                        {
                            'error_code': 'PRICE_BELOW_MINIMUM',
                            'product_id': product.id,
                            'submitted': str(submitted),
                            'minimum': str(server_price),
                        },
                    )
                unit_price = server_price
                subtotal   = unit_price * qty
                total      = subtotal + tax
            else:
                unit_price = self._dec(item.get('price', '0'))
                subtotal   = (
                    self._dec(item.get('subtotal'))
                    if item.get('subtotal') is not None
                    else unit_price * qty
                )
                total = (
                    self._dec(item.get('total'))
                    if item.get('total') is not None
                    else subtotal + tax
                )
            line_key = self._line_key(item, position)
            seen_keys.add(line_key)
            line = existing.get(line_key) or OrderLine(order=order, external_line_id=line_key)
            line.product = product
            line.wc_product_id = item.get('product_id') or item.get('wc_product_id')
            line.product_name = item.get('name', product.name if product else 'Unknown')
            line.barcode = item.get('sku', product.barcode if product else '')
            line.quantity = qty
            line.unit_price = unit_price
            line.subtotal = subtotal
            line.tax = tax
            line.total = total
            line.is_deleted = False
            line.save()
            lines.append(line)

        OrderLine.all_objects.filter(order=order).exclude(
            external_line_id__in=seen_keys,
        ).update(is_deleted=True)
        return lines

    def _server_unit_price(self, product, sales_channel) -> Decimal:
        """Server-authoritative unit price for a POS/manual line.

        Starts from the product catalogue price and applies the BEST currently
        active promotion for this product on this sales channel. The client can
        therefore never set or under-price a line — it can only be sold at the
        catalogue price or a legitimate promotional price.
        """
        base = self._dec(getattr(product, 'sales_price', None) or '0')
        if sales_channel is None:
            return base

        from django.db.models import Q
        from django.utils import timezone
        from apps.promotions.models import Promotion, PromotionStatus

        now = timezone.now()
        candidates = Promotion.objects.filter(
            product=product,
            is_active=True,
            status=PromotionStatus.ACTIVE,
            start_date__lte=now,
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=now))

        best = base
        for promo in candidates:
            if not promo.is_within_usage_limit:
                continue
            price = self._dec(promo.calculate_discounted_price(base, sales_channel.id))
            if price < best:
                best = price
        return best

    def _resolve_product(
        self,
        item: dict,
        sales_channel: SalesChannel,
    ) -> Optional[Product]:
        """
        Match a line item to a local Product with async fallback.

        Strategy:
        1. Cache check (channel_id, wc_pid)
        2. DB query by wc_product_id
        3. Async fetch from WooCommerce if not found locally
        4. Fallback: local product ID (POS / manual)
        5. Fallback: SKU / barcode
        6. Return None if all fail
        
        Note: Async fetch is attempted with async_if_missing=True,
        which queues a Celery task rather than blocking on the sync call.
        """
        wc_pid = item.get('product_id') or item.get('wc_product_id')
        if wc_pid:
            # Check cache first
            cache_key = (sales_channel.id, wc_pid)
            if cache_key in self._product_cache:
                return self._product_cache[cache_key]

            # Try to find locally via SalesChannelInventory relationship
            product = (
                Product.objects
                .filter(
                    sales_channel_inventories__sales_channel=sales_channel,
                    wc_product_id=wc_pid,
                )
                .distinct()
                .first()
            )
            
            if product:
                self._product_cache[cache_key] = product
                return product

            # Product not found locally — try async fetch from WooCommerce
            # This queues a Celery task in production, no blocking
            product = ProductSyncService.get_or_fetch_product(
                wc_product_id=wc_pid,
                sales_channel=sales_channel,
                async_if_missing=True,  # Queue task instead of blocking
            )
            self._product_cache[cache_key] = product
            if product:
                logger.info(
                    "Product resolved via async WooCommerce sync: "
                    "wc_id=%s, product_id=%s, name=%s",
                    wc_pid, product.id, product.name
                )
                return product

        # Fallback 1: local product ID (POS / manual)
        local_id = item.get('local_product_id')
        if local_id:
            try:
                return Product.objects.get(pk=local_id, brand=sales_channel.brand)
            except Product.DoesNotExist:
                pass

        # Fallback 2: SKU / barcode
        sku = item.get('sku', '')
        if sku:
            try:
                return Product.objects.get(brand=sales_channel.brand, barcode=sku)
            except Product.DoesNotExist:
                pass

        return None

    # ─── totals ───────────────────────────────────────────────────────────────

    def _recalc_totals(self, order: Order, payload: dict, lines: list | None = None) -> None:
        if lines is None:
            order.recalculate_totals()
            return

        subtotal = sum((line.subtotal for line in lines), Decimal('0.00'))
        tax_total = sum((line.tax for line in lines), Decimal('0.00'))
        lines_total = sum((line.total for line in lines), Decimal('0.00'))

        discount_total = Decimal('0.00')
        if order.discount_type == Order.DiscountType.FIXED:
            discount_total = max(Decimal('0.00'), order.discount_value)
        elif order.discount_type == Order.DiscountType.PERCENTAGE:
            discount_total = (lines_total * order.discount_value) / Decimal('100.00')

        discount_total = min(discount_total, lines_total)
        total = max(Decimal('0.00'), lines_total - discount_total)

        order.subtotal = subtotal.quantize(self._TWO_PLACES)
        order.tax_total = tax_total.quantize(self._TWO_PLACES)
        order.discount_total = discount_total.quantize(self._TWO_PLACES)
        order.total = total.quantize(self._TWO_PLACES)

    # ─── inventory movements ──────────────────────────────────────────────────

    @classmethod
    def _line_quantities_by_product(cls, lines: list) -> dict[int, dict]:
        quantities: dict[int, dict] = {}
        pack_component_ids = {
            int(item.get('product_id'))
            for line in lines
            if line.product_id and line.product and line.product.is_pack and line.product.pack_items
            for item in line.product.pack_items
            if isinstance(item, dict) and item.get('product_id')
        }
        pack_components = {
            product.id: product
            for product in Product.objects.filter(id__in=pack_component_ids)
        }

        for line in lines:
            if not line.product_id:
                continue
            if line.product and line.product.product_type == Product.ProductType.PACKAGING_ITEM:
                # Packaging/store products are handled by OrderLifecycleService.package_order().
                # They must never be treated as customer sale lines during normal order stock sync.
                continue

            if line.product and line.product.is_pack:
                cls._add_pack_component_quantities(
                    quantities=quantities,
                    line=line,
                    components=pack_components,
                )
                continue

            cls._add_desired_quantity(
                quantities=quantities,
                product=line.product,
                quantity=line.quantity,
                unit_cost=line.unit_price,
                total_cost=line.total,
                source_line=line.product_name,
            )
        return quantities

    @staticmethod
    def _add_desired_quantity(
        *,
        quantities: dict[int, dict],
        product: Product,
        quantity: int,
        unit_cost,
        total_cost,
        source_line: str = '',
        source_pack: Product | None = None,
    ) -> None:
        current = quantities.setdefault(
            product.id,
            {
                'product': product,
                'quantity': 0,
                'unit_cost': unit_cost,
                'total_cost': Decimal('0.00'),
                'source_lines': [],
                'source_packs': [],
            },
        )
        current['quantity'] += quantity
        current['total_cost'] += total_cost or Decimal('0.00')
        if source_line and source_line not in current['source_lines']:
            current['source_lines'].append(source_line)
        if source_pack and source_pack.name not in current['source_packs']:
            current['source_packs'].append(source_pack.name)

    @classmethod
    def _add_pack_component_quantities(
        cls,
        *,
        quantities: dict[int, dict],
        line: OrderLine,
        components: dict[int, Product],
    ) -> None:
        pack = line.product
        if not pack or not pack.pack_items:
            raise OrderIngestionError(
                f'Impossible de vendre ce pack: composant manquant ou stock insuffisant.',
                {
                    'error_code': 'PACK_COMPONENTS_INVALID',
                    'pack_errors': [{
                        'pack_product_id': line.product_id,
                        'pack_name': line.product_name,
                        'message': f'Le pack {line.product_name} ne contient aucun composant valide.',
                    }],
                },
            )

        component_errors = []
        for item in pack.pack_items:
            if not isinstance(item, dict):
                component_errors.append({
                    'pack_product_id': pack.id,
                    'pack_name': pack.name,
                    'message': f'Le pack {pack.name} contient une ligne composant invalide.',
                })
                continue

            component_id = item.get('product_id')
            per_pack_qty = item.get('quantity')
            try:
                component_id = int(component_id)
                per_pack_qty = int(per_pack_qty)
            except (TypeError, ValueError):
                component_errors.append({
                    'pack_product_id': pack.id,
                    'pack_name': pack.name,
                    'component_id': component_id,
                    'message': f'Le pack {pack.name} contient une quantité composant invalide.',
                })
                continue

            component = components.get(component_id)
            if not component:
                component_errors.append({
                    'pack_product_id': pack.id,
                    'pack_name': pack.name,
                    'component_id': component_id,
                    'message': f'Impossible de vendre ce pack: composant {component_id} manquant.',
                })
                continue

            required_qty = per_pack_qty * line.quantity
            cls._add_desired_quantity(
                quantities=quantities,
                product=component,
                quantity=required_qty,
                unit_cost=None,
                total_cost=Decimal('0.00'),
                source_line=line.product_name,
                source_pack=pack,
            )

        if component_errors:
            raise OrderIngestionError(
                f'Impossible de vendre ce pack: composant manquant ou stock insuffisant.',
                {
                    'error_code': 'PACK_COMPONENTS_INVALID',
                    'pack_errors': component_errors,
                },
            )

    @staticmethod
    def _net_moved_quantities(order: Order, sales_channel: SalesChannel) -> dict[int, int]:
        movement_rows = (
            InventoryMovement.objects
            .filter(
                sales_channel=sales_channel,
                external_reference=order.order_number,
                status=InventoryMovement.MovementStatus.COMPLETED,
            )
            .exclude(
                product__product_type=Product.ProductType.PACKAGING_ITEM,
            )
            .filter(
                movement_type__in=[
                    InventoryMovement.MovementType.SALE,
                    InventoryMovement.MovementType.RETURN_IN,
                ],
            )
            .values('product_id', 'movement_type')
            .annotate(total=models.Sum('quantity'))
        )

        moved: dict[int, int] = {}
        for row in movement_rows:
            sign = 1 if row['movement_type'] == InventoryMovement.MovementType.SALE else -1
            moved[row['product_id']] = moved.get(row['product_id'], 0) + (sign * (row['total'] or 0))
        return moved

    @classmethod
    def _sync_inventory_movements(
        cls,
        order: Order,
        lines: list,
        sales_channel: SalesChannel,
        created_by,
    ) -> None:
        desired = {}
        if order.status in WC_MOVEMENT_STATUSES:
            desired = cls._line_quantities_by_product(lines)

        already_moved = cls._net_moved_quantities(order, sales_channel)
        product_ids = set(desired) | set(already_moved)
        if not product_ids:
            return

        inventories = {
            inv.product_id: inv
            for inv in (
                SalesChannelInventory.objects
                .select_for_update()
                .filter(sales_channel=sales_channel, product_id__in=product_ids)
            )
        }

        products = {
            product.id: product
            for product in Product.objects.filter(id__in=product_ids)
        }

        for product_id in product_ids:
            desired_qty = desired.get(product_id, {}).get('quantity', 0)
            moved_qty = already_moved.get(product_id, 0)
            delta = desired_qty - moved_qty

            if delta == 0:
                continue

            product = desired.get(product_id, {}).get('product') or products.get(product_id)
            if not product:
                continue

            inventory = inventories.get(product_id)

            if delta > 0:
                line_data = desired.get(product_id, {})
                source_packs = line_data.get('source_packs') or []
                if not inventory:
                    if source_packs:
                        pack_name = source_packs[0]
                        raise OrderIngestionError(
                            f'Impossible de vendre ce pack: composant manquant ou stock insuffisant.',
                            {
                                'error_code': 'PACK_STOCK_INSUFFICIENT',
                                'pack_errors': [{
                                    'pack_name': pack_name,
                                    'component_id': product_id,
                                    'component_name': product.name,
                                    'required': delta,
                                    'available': 0,
                                    'message': f'Le produit {product.name} est insuffisant dans ce pack.',
                                }],
                                'message': f'Stock insuffisant pour le pack {pack_name}.',
                            },
                        )
                    raise OrderIngestionError(
                        f'Product "{product.name}" has no inventory in channel {sales_channel.name}.',
                        {'product_id': product_id, 'required': delta, 'available': 0},
                    )
                if inventory.available_quantity < delta:
                    if source_packs:
                        pack_name = source_packs[0]
                        raise OrderIngestionError(
                            f'Stock insuffisant pour le pack {pack_name}.',
                            {
                                'error_code': 'PACK_STOCK_INSUFFICIENT',
                                'pack_errors': [{
                                    'pack_name': pack_name,
                                    'component_id': product_id,
                                    'component_name': product.name,
                                    'required': delta,
                                    'available': inventory.available_quantity,
                                    'message': f'Le produit {product.name} est insuffisant dans ce pack.',
                                }],
                            },
                        )
                    raise OrderIngestionError(
                        f'Insufficient stock for "{product.name}". Required: {delta}, available: {inventory.available_quantity}.',
                        {
                            'product_id': product_id,
                            'required': delta,
                            'available': inventory.available_quantity,
                            'order_number': order.order_number,
                        },
                    )

                quantity_before = inventory.quantity
                quantity_after = quantity_before - delta
                InventoryMovement.objects.create(
                    sales_channel=sales_channel,
                    product=product,
                    movement_type=InventoryMovement.MovementType.SALE,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=delta,
                    quantity_before=quantity_before,
                    quantity_after=quantity_after,
                    unit_cost=line_data.get('unit_cost'),
                    total_cost=line_data.get('total_cost'),
                    external_reference=order.order_number,
                    notes=(
                        f"Auto sale movement for order {order.order_number}"
                        + (
                            f" (pack: {', '.join(source_packs)})"
                            if source_packs else ""
                        )
                    ),
                    created_by=created_by,
                    completed_at=timezone.now(),
                )
                if inventory:
                    inventory.quantity = quantity_after
            else:
                quantity = abs(delta)
                quantity_before = inventory.quantity if inventory else 0
                quantity_after = quantity_before + quantity
                InventoryMovement.objects.create(
                    sales_channel=sales_channel,
                    product=product,
                    movement_type=InventoryMovement.MovementType.RETURN_IN,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=quantity,
                    quantity_before=quantity_before,
                    quantity_after=quantity_after,
                    external_reference=order.order_number,
                    notes=f"Auto stock reversal for order {order.order_number}",
                    created_by=created_by,
                    completed_at=timezone.now(),
                )
                if inventory:
                    inventory.quantity = quantity_after

    @classmethod
    def _create_sale_movements(
        cls,
        order: Order,
        lines: list,
        sales_channel: SalesChannel,
        created_by,
    ) -> None:
        """Backward-compatible wrapper for older callers."""
        cls._sync_inventory_movements(order, lines, sales_channel, created_by)

    # ─── WC status mapping ────────────────────────────────────────────────────

    WC_STATUS_MAP = {
        'pending':    Order.Status.PENDING,
        'processing': Order.Status.PROCESSING,
        'on-hold':    Order.Status.ON_HOLD,
        'completed':  Order.Status.COMPLETED,
        'cancelled':  Order.Status.CANCELLED,
        'refunded':   Order.Status.REFUNDED,
        'failed':     Order.Status.FAILED,
    }

    @classmethod
    def _map_wc_status(cls, wc_status: str) -> str:
        return cls.WC_STATUS_MAP.get(wc_status, Order.Status.PENDING)

    @staticmethod
    def _map_payment_status(wc_status: str, payload: dict) -> str:
        if wc_status in ('completed', 'processing'):
            return Order.PaymentStatus.PAID
        if wc_status == 'refunded':
            return Order.PaymentStatus.REFUNDED
        return Order.PaymentStatus.UNPAID

    # ─── helpers ──────────────────────────────────────────────────────────────

    # Canonical precision for all money fields (decimal_places=2)
    _TWO_PLACES = Decimal('0.01')

    @staticmethod
    def _stable_import_hash(payload: Dict[str, Any], sales_channel: SalesChannel) -> str:
        """Stable fallback idempotency key for payloads without a reliable external ID."""
        external_id = str(payload.get('id', '') or payload.get('external_order_id', ''))
        wc_order_key = str(payload.get('order_key', '') or '')
        client_ticket_uuid = str(payload.get('client_ticket_uuid', '') or '')
        ticket_id = str(payload.get('ticket_id', '') or '')
        if external_id or wc_order_key or client_ticket_uuid or ticket_id:
            return ''

        billing = payload.get('billing', {}) or {}
        lines = []
        for item in payload.get('line_items', []) or []:
            lines.append({
                'product_id': item.get('product_id') or item.get('wc_product_id') or item.get('local_product_id') or '',
                'sku': str(item.get('sku', '') or '').strip().lower(),
                'qty': str(item.get('quantity', '') or ''),
            })
        stable = {
            'channel': sales_channel.id,
            'email': str(billing.get('email', '') or '').strip().lower(),
            'phone': str(billing.get('phone', '') or '').strip(),
            'lines': sorted(lines, key=lambda x: json.dumps(x, sort_keys=True)),
            'total': str(payload.get('total', '') or ''),
            'created': str(payload.get('date_created', '') or ''),
        }
        raw = json.dumps(stable, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()

    @staticmethod
    def _line_key(item: dict, position: int) -> str:
        explicit = item.get('id') or item.get('line_id') or item.get('external_line_id')
        if explicit:
            return str(explicit)
        stable = {
            'position': position,
            'product_id': item.get('product_id') or item.get('wc_product_id') or item.get('local_product_id') or '',
            'sku': str(item.get('sku', '') or '').strip().lower(),
            'name': str(item.get('name', '') or '').strip().lower(),
            'qty': str(item.get('quantity', '') or ''),
            'total': str(item.get('total', '') or ''),
        }
        raw = json.dumps(stable, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]

    @classmethod
    def _dec(cls, value) -> Decimal:
        """
        Convert any money value from WooCommerce to a Decimal with exactly
        2 decimal places.  WooCommerce returns strings like "10.000" which
        exceed decimal_places=2 and cause validation errors at save time.
        """
        if value is None or value == '':
            return Decimal('0.00')
        try:
            return Decimal(str(value)).quantize(cls._TWO_PLACES, rounding=ROUND_HALF_UP)
        except (InvalidOperation, ValueError, TypeError):
            return Decimal('0.00')

    @staticmethod
    def _parse_dt(value):
        """
        Parse a WooCommerce datetime string into a timezone-aware datetime.
        WooCommerce sometimes omits the UTC offset, producing a naive datetime
        from parse_datetime().  We make it aware to satisfy USE_TZ=True.
        """
        if not value:
            return None
        if isinstance(value, str):
            dt = parse_datetime(value)
            if dt is not None and timezone.is_naive(dt):
                dt = timezone.make_aware(dt)
            return dt
        return value

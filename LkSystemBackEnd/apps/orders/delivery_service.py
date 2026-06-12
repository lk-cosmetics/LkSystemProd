"""
LkSystem Orders App - DeliverySubmissionService
═══════════════════════════════════════════════════════════════════════════════
Handles the full lifecycle of submitting an order to the external delivery
provider and tracking the result.

Design decisions:
  • The WooCommerce order status is NEVER changed to "completed" just because
    we submitted to the delivery provider.  These are two separate concerns:
      - Order status tracks the payment/fulfillment lifecycle in WooCommerce.
      - Delivery status tracks the physical shipment lifecycle.
  • All API calls and their responses are stored on Order.delivery_response
    for audit and replay.
  • Submission is idempotent: re-submitting a SUBMITTED order only updates
    tracking info, it does not create a duplicate shipment.
  • The service raises DeliveryError on failure so the caller (Celery task
    or view) can handle retry logic.

Delivery payload fields (from WordPress integration):
  referenceExterne   ← order.order_number
  nomContact         ← billing name
  tel                ← billing phone (primary)
  tel2               ← billing phone from meta or shipping phone
  adresseLivraison   ← shipping address
  governorat         ← shipping state / governorate
  delegation         ← billing city (delegation in TN)
  description        ← order items summary
  cod                ← order total (cash on delivery amount)
  echange            ← from WC meta _echange (exchange flag, default False)
"""

import logging
import re
import unicodedata
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.orders.models import Order, OrderLog
from apps.orders.logging_service import OrderLoggingService

logger = logging.getLogger(__name__)

# Default retry budget
MAX_DELIVERY_ATTEMPTS = 3
DEFAULT_JAX_CREATE_URL = 'https://core.jax-delivery.com/api/user/colis/add'

GOVERNORATE_IDS = {
    'nabeul': 1,
    'gafsa': 2,
    'sfax': 3,
    'tunis': 4,
    'bizerte': 5,
    'jendouba': 6,
    'tozeur': 7,
    'tataouine': 8,
    'kef': 9,
    'sidi bouzid': 10,
    'manouba': 11,
    'beja': 12,
    'gabes': 13,
    'zaghouan': 14,
    'ariana': 15,
    'kairouan': 16,
    'monastir': 17,
    'mahdia': 18,
    'siliana': 19,
    'ben arous': 20,
    'medenine': 21,
    'kasserine': 22,
    'sousse': 23,
    'kebili': 24,
}

GOVERNORATE_ALIASES = {
    # Common WooCommerce/custom state codes.
    'ar': 'ariana',
    'ari': 'ariana',
    'ba': 'ben arous',
    'ben': 'ben arous',
    'be': 'beja',
    'bj': 'beja',
    'bej': 'beja',
    'bz': 'bizerte',
    'biz': 'bizerte',
    'gb': 'gabes',
    'gab': 'gabes',
    'gf': 'gafsa',
    'gaf': 'gafsa',
    'jd': 'jendouba',
    'je': 'jendouba',
    'jen': 'jendouba',
    'kr': 'kairouan',
    'kai': 'kairouan',
    'ks': 'kasserine',
    'kas': 'kasserine',
    'kb': 'kebili',
    'keb': 'kebili',
    'kf': 'kef',
    'lk': 'kef',
    'mah': 'mahdia',
    'mh': 'mahdia',
    'lm': 'manouba',
    'man': 'manouba',
    'md': 'medenine',
    'med': 'medenine',
    'mon': 'monastir',
    'mn': 'monastir',
    'ms': 'monastir',
    'nab': 'nabeul',
    'nb': 'nabeul',
    'sf': 'sfax',
    'sfa': 'sfax',
    'sb': 'sidi bouzid',
    'sid': 'sidi bouzid',
    'si': 'siliana',
    'sil': 'siliana',
    'sl': 'siliana',
    'sou': 'sousse',
    'ss': 'sousse',
    'ta': 'tataouine',
    'tat': 'tataouine',
    'tt': 'tataouine',
    'toz': 'tozeur',
    'tz': 'tozeur',
    'ts': 'tunis',
    'tu': 'tunis',
    'tun': 'tunis',
    'zg': 'zaghouan',
    'zag': 'zaghouan',
    'za': 'zaghouan',
    # ISO 3166-2:TN codes mapped to the JAX governorate IDs above.
    'tn 11': 'tunis',
    'tn 12': 'ariana',
    'tn 13': 'ben arous',
    'tn 14': 'manouba',
    'tn 21': 'nabeul',
    'tn 22': 'zaghouan',
    'tn 23': 'bizerte',
    'tn 31': 'beja',
    'tn 32': 'jendouba',
    'tn 33': 'kef',
    'tn 34': 'siliana',
    'tn 41': 'kairouan',
    'tn 42': 'kasserine',
    'tn 43': 'sidi bouzid',
    'tn 51': 'sousse',
    'tn 52': 'monastir',
    'tn 53': 'mahdia',
    'tn 61': 'sfax',
    'tn 71': 'gafsa',
    'tn 72': 'tozeur',
    'tn 73': 'kebili',
    'tn 81': 'gabes',
    'tn 82': 'medenine',
    'tn 83': 'tataouine',
}


# Canonical display names — kept in sync with the frontend list in
# src/constants/tunisia.ts so an imported governorate matches the governorate
# <select> options exactly.
GOVERNORATE_DISPLAY_NAMES = [
    'Nabeul', 'Gafsa', 'Sfax', 'Tunis', 'Bizerte', 'Jendouba', 'Tozeur',
    'Tataouine', 'Kef', 'Sidi Bouzid', 'Manouba', 'Beja', 'Gabès', 'Zaghouan',
    'Ariana', 'Kairouan', 'Monastir', 'Mahdia', 'Siliana', 'Ben Arous',
    'Medenine', 'Kasserine', 'Sousse', 'Kebili',
]


def _gov_key(value: str) -> str:
    """Accent-insensitive, lowercase, space-collapsed key for matching."""
    normalized = unicodedata.normalize('NFKD', value or '')
    ascii_text = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
    return ' '.join(ascii_text.lower().replace('-', ' ').split())


_GOVERNORATE_DISPLAY_BY_KEY = {_gov_key(n): n for n in GOVERNORATE_DISPLAY_NAMES}


def canonical_governorate_name(value):
    """Map a raw WooCommerce ``billing.state`` — a 2-letter code (``NB``), an
    ISO code (``TN-21``) or a name — to the canonical display governorate name
    (``Nabeul``). Returns the original value unchanged when it cannot be
    recognised, so unknown inputs are never corrupted.
    """
    if not value:
        return value
    text = str(value).strip()
    key = _gov_key(text)
    if key in _GOVERNORATE_DISPLAY_BY_KEY:
        return _GOVERNORATE_DISPLAY_BY_KEY[key]
    compact = key.replace(' ', '')
    alias = GOVERNORATE_ALIASES.get(key) or GOVERNORATE_ALIASES.get(compact)
    if not alias and compact.startswith('tn') and len(compact) == 4:
        alias = GOVERNORATE_ALIASES.get(f'tn {compact[2:]}')
    if alias:
        return _GOVERNORATE_DISPLAY_BY_KEY.get(alias, alias.title())
    return text


class DeliveryError(Exception):
    """Raised when the delivery provider rejects or fails to process a submission."""

    def __init__(self, message: str, status_code: int = 0, response_body: str = ''):
        self.message       = message
        self.status_code   = status_code
        self.response_body = response_body
        super().__init__(message)


class DeliverySubmissionService:
    """
    Submits a single Order to the external delivery provider.

    Usage:
        service = DeliverySubmissionService()
        service.submit(order, actor=request.user)

    The delivery API URL and auth token are read from Django settings:
        DELIVERY_API_URL   – base URL of the delivery provider
        DELIVERY_API_TOKEN – Bearer token (or empty for no auth)
        DELIVERY_API_TIMEOUT – HTTP timeout in seconds (default 15)
    """

    def __init__(self):
        self._api_url     = getattr(settings, 'DELIVERY_API_URL', DEFAULT_JAX_CREATE_URL)
        self._api_token   = getattr(settings, 'DELIVERY_API_TOKEN', '')
        self._api_timeout = getattr(settings, 'DELIVERY_API_TIMEOUT', 15)

    # ─── public API ───────────────────────────────────────────────────────────

    def submit(self, order: Order, actor=None) -> dict:
        """
        Build the delivery payload, POST it to the provider, and record the result.

        Returns the provider's response body as a dict.

        Raises DeliveryError on HTTP or provider-level failure.
        Do NOT catch this here — the caller (view or Celery task) handles retries.
        """
        with transaction.atomic():
            order = (
                Order.all_objects
                .select_for_update()
                .select_related('sales_channel')
                .prefetch_related('lines')
                .get(pk=order.pk)
            )
            self._api_token = (order.sales_channel.delivery_api_key or self._api_token or '').strip()

            if order.delivery_reference:
                raise DeliveryError(
                    f"Order {order.order_number} has already been sent to delivery."
                )

            if not order.can_submit_delivery:
                raise DeliveryError(
                    f"Order {order.order_number} is not eligible for delivery submission "
                    f"(status={order.status})."
                )

            if not self._api_token:
                raise DeliveryError(
                    f"Delivery API key is not configured for sales channel {order.sales_channel.name}."
                )

            if not self._api_url:
                raise DeliveryError(
                    "DELIVERY_API_URL is not configured in Django settings."
                )

            payload = self._build_payload(order)

            # Count the attempt before the network call (audit metadata).
            order.delivery_attempts += 1
            order.save(update_fields=['delivery_attempts', 'updated_at'])

            OrderLoggingService.log(
                order=order,
                action=OrderLog.Action.DELIVERY_QUEUED,
                user=actor,
                details={'payload': payload, 'attempt': order.delivery_attempts},
            )

        # Call the delivery API
        try:
            response = requests.post(
                url=self._endpoint_url(),
                json=payload,
                params={'token': self._api_token},
                headers={'Content-Type': 'application/json'},
                timeout=self._api_timeout,
            )
            response.raise_for_status()
            parsed_response = response.json()
            response_data = (
                parsed_response
                if isinstance(parsed_response, dict)
                else {'response': parsed_response}
            )

        except requests.exceptions.Timeout as exc:
            self._handle_failure(
                order,
                actor,
                f"Request timed out: {self._sanitize_error(exc)}",
            )
            raise DeliveryError(f"Delivery API timeout for order {order.order_number}") from exc

        except requests.exceptions.ConnectionError as exc:
            self._handle_failure(
                order,
                actor,
                f"Connection error: {self._sanitize_error(exc)}",
            )
            raise DeliveryError("Cannot reach delivery API.") from exc

        except requests.exceptions.HTTPError as exc:
            body = ''
            try:
                body = exc.response.text[:500]
            except Exception:
                pass
            body = self._sanitize_error(body)
            self._handle_failure(order, actor, f"HTTP {exc.response.status_code}: {body}")
            raise DeliveryError(
                f"Delivery API returned HTTP {exc.response.status_code}",
                status_code=exc.response.status_code,
                response_body=body,
            ) from exc

        except Exception as exc:
            self._handle_failure(order, actor, self._sanitize_error(exc))
            raise DeliveryError("Unexpected delivery API error.") from exc

        # Success — record tracking reference and mark submitted
        delivery_ref = self._delivery_reference(response_data)

        with transaction.atomic():
            order = (
                Order.all_objects
                .select_for_update()
                .select_related('sales_channel')
                .get(pk=order.pk)
            )
            if order.delivery_reference:
                raise DeliveryError(
                    f"Order {order.order_number} has already been sent to delivery."
                )

            order.delivery_reference    = str(delivery_ref)
            order.delivery_code         = str(response_data.get('code') or '')
            order.delivery_external_reference = str(
                response_data.get('referenceExterne')
                or payload.get('referenceExterne')
                or ''
            )
            order.delivery_status_id    = self._safe_int(response_data.get('statut_id'))
            order.delivery_order_id     = self._safe_int(response_data.get('id'))
            order.delivery_client_id    = self._safe_int(response_data.get('client_id'))
            order.delivery_cod_amount   = self._safe_decimal(
                response_data.get('cod')
                or response_data.get('cash')
                or payload.get('cod')
            )
            order.delivery_submitted_at = timezone.now()
            order.delivery_submitted_by = actor
            order.delivery_response     = response_data
            order.save(update_fields=[
                'delivery_reference', 'delivery_code',
                'delivery_external_reference', 'delivery_status_id',
                'delivery_order_id', 'delivery_client_id', 'delivery_cod_amount',
                'delivery_submitted_at', 'delivery_submitted_by',
                'delivery_response', 'updated_at',
            ])

            OrderLoggingService.log(
                order=order,
                action=OrderLog.Action.DELIVERY_SUBMITTED,
                user=actor,
                details={
                    'reference': delivery_ref,
                    'delivery_code': order.delivery_code,
                    'delivery_order_id': order.delivery_order_id,
                    'status_id': order.delivery_status_id,
                    'response': response_data,
                    'attempt': order.delivery_attempts,
                },
            )

        logger.info(
            "Order %s submitted to delivery provider. Reference: %s",
            order.order_number, delivery_ref,
        )
        return response_data

    def update_from_provider(self, order: Order, provider_status: str, actor=None) -> None:
        """Apply a provider webhook / polling result.

        The raw provider state is technical metadata (kept in
        ``delivery_response['provider_status']`` + the audit log). Terminal
        events move the canonical ``Order.status``:

        * delivered → done (the sale is realised; stock deducts on done)
        * returned  → returned
        * cancelled → canceled
        * failed / in-transit / accepted → no lifecycle move (operator decides)
        """
        mapped = self._map_provider_status(provider_status)
        previous = (order.delivery_response or {}).get('provider_status', '')
        if mapped == previous:
            return  # no-op

        from django.db import transaction
        from apps.orders.service import OrderIngestionService
        from apps.orders.status_service import OrderStatusService

        with transaction.atomic():
            response = dict(order.delivery_response or {})
            response['provider_status'] = mapped
            response['provider_status_raw'] = str(provider_status or '')
            response['provider_status_at'] = timezone.now().isoformat()
            order.delivery_response = response
            order.save(update_fields=['delivery_response', 'updated_at'])

            if mapped == 'delivered':
                OrderStatusService.transition(
                    order, Order.Status.DONE, actor=actor,
                    note='delivery provider confirmed delivered', force=True,
                )
            elif mapped == 'returned':
                if not order.returned_at:
                    order.returned_at = timezone.now()
                    order.return_reason = order.return_reason or 'returned by delivery provider'
                    order.save(update_fields=['returned_at', 'return_reason', 'updated_at'])
                OrderStatusService.transition(
                    order, Order.Status.RETURNED, actor=actor,
                    note='delivery provider reported returned', force=True,
                )
            elif mapped == 'cancelled':
                OrderStatusService.transition(
                    order, Order.Status.CANCELED, actor=actor,
                    note='delivery provider reported cancelled',
                    force=(order.status in (Order.Status.DONE, Order.Status.RETURNED)),
                )

            # Reconcile stock with the (possibly new) canonical status — the
            # delta engine deducts on done, reverses on returned/canceled, and
            # no-ops otherwise. Same engine as POS validation and packaging,
            # so it can never double-apply.
            inventory_channel = order.pos_sales_channel or order.sales_channel
            if inventory_channel and mapped in ('delivered', 'returned', 'cancelled', 'failed'):
                lines = list(
                    order.lines.filter(is_deleted=False).select_related('product')
                )
                OrderIngestionService._sync_inventory_movements(
                    order, lines, inventory_channel, actor,
                )

        action_map = {
            'accepted':  OrderLog.Action.DELIVERY_ACCEPTED,
            'delivered': OrderLog.Action.DELIVERY_DELIVERED,
            'failed':    OrderLog.Action.DELIVERY_FAILED,
            'returned':  OrderLog.Action.DELIVERY_RETURNED,
        }
        action = action_map.get(mapped, OrderLog.Action.DELIVERY_SUBMITTED)

        OrderLoggingService.log(
            order=order, action=action, user=actor,
            details={'old_provider_status': previous, 'new_provider_status': mapped,
                     'provider_status': str(provider_status or '')},
        )

    # ─── payload builder ──────────────────────────────────────────────────────

    def _build_payload(self, order: Order) -> dict:
        """
        Build the delivery provider payload from the Order object.

        Maps to the fields used by the WordPress delivery integration:
          referenceExterne, nomContact, tel, tel2, adresseLivraison,
          governorat, delegation, description, cod, echange
        """
        # Resolve phone numbers — the DELIVERY contact (shipping phone first,
        # billing snapshot fallback): the recipient is who the courier calls.
        primary_phone = order.delivery_phone or ''
        secondary_phone = order.get_wc_meta('_secondary_phone', '') or primary_phone

        # Build item description line
        lines = order.lines.filter(is_deleted=False).select_related('product')
        description_parts = [
            f"{line.product_name} x{line.quantity}"
            for line in lines
        ]
        description = ', '.join(description_parts) or 'Order items'

        # WooCommerce meta flags
        echange = order.get_wc_meta('_echange', False)
        if isinstance(echange, str):
            echange = echange.lower() in ('1', 'true', 'yes', 'oui')

        governorate_name = order.shipping_state or order.billing_state or ''
        governorate_id = self._governorate_id(governorate_name)
        if governorate_id is None:
            raise DeliveryError(
                f'Cannot map governorate "{governorate_name or "empty"}" to a JAX governorate ID.'
            )

        pickup_governorate_id = self._governorate_id(order.sales_channel.state)
        payload = {
            'referenceExterne': order.external_order_id or order.order_number,
            # Delivery recipient, NOT the buyer: shipping name wins over the
            # billing snapshot (people order for someone else all the time).
            'nomContact': order.delivery_name or 'Client',
            'tel': primary_phone,
            'tel2': secondary_phone or primary_phone,
            'adresseLivraison': self._delivery_address(order),
            'governorat': governorate_id,
            'delegation': order.shipping_city or order.billing_city or '',
            'description': description,
            'cod': self._money(order.total),
            'echange': 1 if echange else 0,
        }
        if pickup_governorate_id is not None:
            payload['gouvernorat_pickup'] = pickup_governorate_id
        if order.sales_channel.address or order.sales_channel.city:
            payload['adresse_pickup'] = (
                order.sales_channel.address or order.sales_channel.city
            )
        if order.sales_channel.phone:
            payload['expediteur_phone'] = order.sales_channel.phone
        if order.sales_channel.name:
            payload['expediteur_name'] = order.sales_channel.name
        return payload

    def _endpoint_url(self) -> str:
        raw_url = (self._api_url or DEFAULT_JAX_CREATE_URL).strip().rstrip('/')
        if raw_url.endswith('/api/user/colis/add'):
            return raw_url
        if raw_url.endswith('/api'):
            return f'{raw_url}/user/colis/add'
        return f'{raw_url}/api/user/colis/add'

    @staticmethod
    def _delivery_address(order: Order) -> str:
        parts = [
            order.shipping_city or order.billing_city,
            order.shipping_address_1 or order.billing_address_1,
            order.billing_address_2,
        ]
        return ', '.join(part for part in parts if part)

    @staticmethod
    def _money(value) -> str:
        amount = Decimal(value or 0).quantize(Decimal('0.001'))
        return format(amount, 'f')

    @staticmethod
    def _normalize_governorate(value: str) -> str:
        normalized = unicodedata.normalize('NFKD', value or '')
        ascii_text = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
        return ' '.join(ascii_text.lower().replace('-', ' ').split())

    @classmethod
    def _governorate_id(cls, value: str) -> int | None:
        if value is None:
            return None
        text = str(value).strip()
        if text.isdigit():
            numeric = int(text)
            return numeric if numeric in GOVERNORATE_IDS.values() else None
        key = cls._normalize_governorate(text)
        if key in GOVERNORATE_IDS:
            return GOVERNORATE_IDS[key]

        compact_key = key.replace(' ', '')
        alias = GOVERNORATE_ALIASES.get(key) or GOVERNORATE_ALIASES.get(compact_key)
        if not alias and compact_key.startswith('tn') and len(compact_key) == 4:
            alias = GOVERNORATE_ALIASES.get(f'tn {compact_key[2:]}')
        if alias:
            return GOVERNORATE_IDS[alias]
        return None

    @staticmethod
    def _safe_int(value) -> int | None:
        try:
            if value is None or value == '':
                return None
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_decimal(value) -> Decimal | None:
        try:
            if value is None or value == '':
                return None
            return Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return None

    @staticmethod
    def _delivery_reference(response_data: dict) -> str:
        return str(
            response_data.get('code')
            or response_data.get('referenceInterne')
            or response_data.get('reference')
            or response_data.get('id')
            or ''
        )

    def _sanitize_error(self, value) -> str:
        message = str(value or '')
        if self._api_token:
            message = message.replace(self._api_token, '***')
        return re.sub(r'([?&]token=)[^\s&]+', r'\1***', message)

    # ─── status mapping ───────────────────────────────────────────────────────

    # Common provider status strings → normalized technical states (metadata
    # only — the canonical lifecycle lives in Order.status).
    _PROVIDER_STATUS_MAP = {
        'accepted':    'accepted',
        'in_transit':  'in_transit',
        'in transit':  'in_transit',
        'delivered':   'delivered',
        'failed':      'failed',
        'cancelled':   'cancelled',
        'returned':    'returned',
        'return':      'returned',
    }

    @classmethod
    def _map_provider_status(cls, provider_status: str) -> str:
        return cls._PROVIDER_STATUS_MAP.get(
            (provider_status or '').lower(), 'submitted',
        )

    # ─── failure handler ──────────────────────────────────────────────────────

    def _handle_failure(self, order: Order, actor, error_msg: str) -> None:
        """Record a submission failure on the order and emit a log entry."""
        with transaction.atomic():
            order = Order.all_objects.select_for_update().get(pk=order.pk)
            if order.delivery_reference:
                return

            order.delivery_response = {
                'error': error_msg,
                'provider_status': 'failed',
                'failed_at': timezone.now().isoformat(),
            }
            order.save(update_fields=['delivery_response', 'updated_at'])

            OrderLoggingService.log(
                order=order,
                action=OrderLog.Action.DELIVERY_FAILED,
                user=actor,
                details={'error': error_msg, 'attempt': order.delivery_attempts},
            )
        logger.error(
            "Delivery submission failed for order %s (attempt %d): %s",
            order.order_number, order.delivery_attempts, error_msg,
        )

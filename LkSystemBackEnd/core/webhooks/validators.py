"""
LkSystem Core Webhooks - Signature Validation
Utilities for validating WooCommerce webhook signatures.
"""

import hmac
import hashlib
import base64
import logging
from typing import Optional, Tuple
from dataclasses import dataclass

from apps.sales_channels.models import SalesChannel
from core.services.exceptions import WebhookValidationError

logger = logging.getLogger(__name__)


@dataclass
class WebhookContext:
    """
    Context object containing validated webhook information.
    
    Passed to webhook handlers after validation succeeds.
    """
    sales_channel: SalesChannel
    topic: str
    source: str
    delivery_id: str
    payload: dict
    raw_body: bytes


class WebhookValidator:
    """
    Validates WooCommerce webhook requests.
    
    Handles:
    - HMAC-SHA256 signature validation
    - Sales channel identification
    - Required header validation
    
    Usage:
        validator = WebhookValidator()
        context = validator.validate(request)
        # context contains validated webhook info
    """
    
    # Required HTTP headers from WooCommerce
    HEADER_SIGNATURE = 'X-WC-Webhook-Signature'
    HEADER_SOURCE = 'X-WC-Webhook-Source'
    HEADER_TOPIC = 'X-WC-Webhook-Topic'
    HEADER_DELIVERY_ID = 'X-WC-Webhook-Delivery-Id'
    
    def validate(self, request) -> WebhookContext:
        """
        Validate a webhook request and return context.
        
        Args:
            request: Django/DRF request object
            
        Returns:
            WebhookContext with validated information
            
        Raises:
            WebhookValidationError: If validation fails
        """
        # Extract headers
        headers = self._extract_headers(request)
        
        # Find sales channel
        sales_channel = self._find_sales_channel(headers['source'])
        
        # Validate signature. Trim the stored token and the incoming header to
        # tolerate stray whitespace/newlines from copy-paste — a secret mismatch
        # (WooCommerce "Secret" != channel.wc_webhook_token) is the #1 cause of
        # webhook 401s. On failure, log WHICH channel/source/topic was rejected
        # so the cause is unambiguous from a single log line.
        try:
            self._validate_signature(
                payload=request.body,
                signature=(headers['signature'] or '').strip(),
                secret=(sales_channel.wc_webhook_token or '').strip(),
            )
        except WebhookValidationError:
            logger.warning(
                "Webhook signature rejected: channel=%s (%s) source=%s topic=%s "
                "sig_prefix=%s body_len=%s — verify the WooCommerce webhook 'Secret' "
                "exactly equals this channel's wc_webhook_token.",
                sales_channel.id, sales_channel.name, headers['source'],
                headers['topic'], (headers['signature'] or '')[:12],
                len(request.body or b''),
            )
            raise
        
        # Build context
        context = WebhookContext(
            sales_channel=sales_channel,
            topic=headers['topic'],
            source=headers['source'],
            delivery_id=headers['delivery_id'],
            payload=request.data if hasattr(request, 'data') else {},
            raw_body=request.body
        )
        
        logger.info(
            f"Validated webhook: topic={context.topic}, "
            f"channel={sales_channel.id}, delivery={context.delivery_id}"
        )
        
        return context
    
    def _extract_headers(self, request) -> dict:
        """Extract and validate required headers."""
        headers = {
            'signature': request.headers.get(self.HEADER_SIGNATURE, ''),
            'source': request.headers.get(self.HEADER_SOURCE, ''),
            'topic': request.headers.get(self.HEADER_TOPIC, ''),
            'delivery_id': request.headers.get(self.HEADER_DELIVERY_ID, ''),
        }
        
        # Check required headers
        if not headers['signature']:
            raise WebhookValidationError(
                "Missing webhook signature",
                header_name=self.HEADER_SIGNATURE
            )
        
        if not headers['source']:
            raise WebhookValidationError(
                "Missing webhook source",
                header_name=self.HEADER_SOURCE
            )
        
        return headers
    
    @staticmethod
    def _host_of(url: str) -> str:
        """Lower-cased host of a URL — scheme / www / port / path insensitive.

        WooCommerce sets ``X-WC-Webhook-Source`` to the site URL; matching on the
        host (rather than a strict prefix) tolerates the harmless differences that
        otherwise cause a spurious 401: http vs https, a ``www.`` prefix, a
        trailing slash, or an extra path segment. Returns '' if unparseable."""
        from urllib.parse import urlparse
        raw = (url or '').strip()
        if not raw:
            return ''
        if '://' not in raw:
            raw = 'http://' + raw  # bare host or host+path
        host = (urlparse(raw).hostname or '').lower()
        return host[4:] if host.startswith('www.') else host

    def _find_sales_channel(self, source: str) -> SalesChannel:
        """Find the active WooCommerce channel that sent this webhook.

        Security note: this only *selects* a channel — the HMAC signature check
        that follows still requires the matching channel's secret, so a loose
        host match never bypasses authentication."""
        if not source:
            raise WebhookValidationError("Empty webhook source")

        channels = list(SalesChannel.objects.filter(
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
            is_active=True,
        ))

        # Primary: host match (tolerant of http/https, www, trailing slash, path).
        source_host = self._host_of(source)
        if source_host:
            for channel in channels:
                if self._host_of(channel.wc_store_url) == source_host:
                    return channel

        # Fallback: legacy strict prefix match (preserves prior behaviour).
        src = source.rstrip('/')
        for channel in channels:
            store_url = (channel.wc_store_url or '').rstrip('/')
            if store_url and src.startswith(store_url):
                return channel

        logger.warning(
            "Webhook source not matched: incoming source=%r (host=%r) matches no "
            "active WooCommerce channel; configured store hosts=%r. Set the "
            "channel's Store URL to the exact site sending the webhook.",
            source, source_host, [self._host_of(c.wc_store_url) for c in channels],
        )
        raise WebhookValidationError(
            "Unknown webhook source",
            details={'source': source}
        )
    
    def _validate_signature(
        self,
        payload: bytes,
        signature: str,
        secret: str
    ) -> None:
        """
        Validate HMAC-SHA256 signature.
        
        Args:
            payload: Raw request body
            signature: Base64-encoded signature from header
            secret: Webhook secret from sales channel config
            
        Raises:
            WebhookValidationError: If signature is invalid
        """
        if not secret:
            raise WebhookValidationError(
                "Webhook token not configured",
                details={'hint': 'Generate a webhook token for this sales channel'}
            )
        
        try:
            # Compute expected signature
            computed = hmac.new(
                key=secret.encode('utf-8'),
                msg=payload,
                digestmod=hashlib.sha256
            ).digest()
            
            computed_b64 = base64.b64encode(computed).decode('utf-8')
            
            # Constant-time comparison (prevents timing attacks)
            if not hmac.compare_digest(computed_b64, signature):
                raise WebhookValidationError("Invalid webhook signature")
                
        except WebhookValidationError:
            raise
        except Exception as e:
            logger.error(f"Signature validation error: {e}")
            raise WebhookValidationError(
                "Signature validation failed",
                details={'error': str(e)}
            )
    
    @staticmethod
    def is_ping(context: WebhookContext) -> bool:
        """Check if this is a test/ping webhook."""
        return (
            context.topic == 'ping' or
            'webhook_id' in context.payload
        )

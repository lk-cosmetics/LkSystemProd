"""
LkSystem Core Webhooks - Centralized Webhook View
Single endpoint for all WooCommerce webhooks.
"""

import logging

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

from .dispatcher import webhook_dispatcher
from .decorators import validate_webhook, WebhookViewMixin

logger = logging.getLogger(__name__)


class UnifiedWebhookView(WebhookViewMixin, APIView):
    """
    Unified webhook endpoint for all WooCommerce events.
    
    This single endpoint handles all webhook topics by dispatching
    to the appropriate registered handler based on the topic.
    
    URL: /api/v1/webhooks/woocommerce/
    
    The topic from X-WC-Webhook-Topic header determines which
    handler processes the request.
    
    Supported Topics:
        - product.created, product.updated, product.deleted
        - product_cat.created, product_cat.updated, product_cat.deleted
        - order.created, order.updated (future)
        - customer.created, customer.updated (future)
    """
    
    permission_classes = [AllowAny]  # Authenticated via signature
    
    def post(self, request):
        """
        Handle incoming WooCommerce webhook.
        
        Validates signature and dispatches to appropriate handler.
        """
        return webhook_dispatcher.dispatch(request)
    
    def get(self, request):
        """
        Health check and handler info endpoint.
        
        Returns list of registered handlers (for debugging).
        """
        from .registry import webhook_registry
        
        handlers = webhook_registry.list_handlers()
        topics = webhook_registry.list_topics()
        
        return Response({
            'status': 'ok',
            'message': 'WooCommerce Webhook Endpoint',
            'registered_topics': topics,
            'handlers': {
                name: {
                    'topics': info.topics,
                    'description': info.description,
                }
                for name, info in handlers.items()
            }
        })


class LegacyProductWebhookView(WebhookViewMixin, APIView):
    """
    Legacy product webhook endpoint for backwards compatibility.
    
    URL: /api/v1/webhooks/woocommerce/products/
    
    Prefer using UnifiedWebhookView for new integrations.
    """
    
    permission_classes = [AllowAny]
    
    @validate_webhook
    def post(self, request, context):
        """Handle product webhooks."""
        from .registry import webhook_registry
        
        # Only handle product topics
        if not context.topic.startswith('product.'):
            return self.error_response(
                f"This endpoint only handles product topics, got: {context.topic}"
            )
        
        # Dispatch to handler
        if webhook_registry.has_handler(context.topic):
            result = webhook_registry.dispatch(context)
            return self.success_response(context, result if isinstance(result, dict) else {})
        
        return self.error_response(f"No handler for topic: {context.topic}")


class LegacyCategoryWebhookView(WebhookViewMixin, APIView):
    """
    Legacy category webhook endpoint for backwards compatibility.
    
    URL: /api/v1/webhooks/woocommerce/categories/
    
    Prefer using UnifiedWebhookView for new integrations.
    """
    
    permission_classes = [AllowAny]
    
    @validate_webhook
    def post(self, request, context):
        """Handle category webhooks."""
        from .registry import webhook_registry
        
        # Only handle category topics
        if not context.topic.startswith('product_cat.'):
            return self.error_response(
                f"This endpoint only handles category topics, got: {context.topic}"
            )
        
        # Dispatch to handler
        if webhook_registry.has_handler(context.topic):
            result = webhook_registry.dispatch(context)
            return self.success_response(context, result if isinstance(result, dict) else {})
        
        return self.error_response(f"No handler for topic: {context.topic}")

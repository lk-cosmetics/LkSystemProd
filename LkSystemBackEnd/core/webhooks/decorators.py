"""
LkSystem Core Webhooks - Decorators
Decorators and mixins for webhook handling.
"""

import functools
import logging
from typing import Callable, List, Optional, Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from core.services.exceptions import WebhookValidationError
from .validators import WebhookValidator, WebhookContext
from .registry import webhook_registry

logger = logging.getLogger(__name__)


def validate_webhook(func: Callable) -> Callable:
    """
    Decorator to validate webhook requests before processing.
    
    Validates signature and extracts context, then passes
    the WebhookContext as the second argument to the view method.
    
    Usage:
        class MyWebhookView(APIView):
            @validate_webhook
            def post(self, request, context: WebhookContext):
                # context contains validated webhook info
                ...
    """
    @functools.wraps(func)
    def wrapper(self, request, *args, **kwargs):
        validator = WebhookValidator()
        
        try:
            context = validator.validate(request)
            
            # Handle ping webhooks automatically
            if validator.is_ping(context):
                return Response({
                    'detail': 'Webhook ping received',
                    'status': 'ok'
                })
            
            # Pass context to the view method
            return func(self, request, context, *args, **kwargs)
            
        except WebhookValidationError as e:
            logger.warning(f"Webhook validation failed: {e.message}")
            return Response(
                e.to_dict(),
                status=status.HTTP_401_UNAUTHORIZED
            )
        except Exception as e:
            logger.exception(f"Error validating webhook: {e}")
            return Response({
                'error': 'ValidationError',
                'message': 'Internal error during webhook validation'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    return wrapper


def webhook_handler(*topics: str, name: str = None):
    """
    Decorator to register a function as a webhook handler.
    
    This is a shortcut for webhook_registry.register().
    
    Usage:
        @webhook_handler('product.created', 'product.updated')
        def handle_product(context: WebhookContext):
            ...
    """
    return webhook_registry.register(*topics, name=name)


class WebhookHandlerMixin:
    """
    Mixin for service classes that handle webhooks.
    
    Provides a standard interface for webhook handling
    that the registry can use.
    
    Usage:
        class ProductService(BaseWooCommerceService, WebhookHandlerMixin):
            WEBHOOK_TOPICS = ['product.created', 'product.updated', 'product.deleted']
            
            def handle_webhook(self, context: WebhookContext) -> dict:
                if context.topic == 'product.deleted':
                    return self.handle_delete(context)
                else:
                    return self.handle_upsert(context)
    """
    
    # Topics this handler supports - override in subclass
    WEBHOOK_TOPICS: List[str] = []
    
    def handle_webhook(self, context: WebhookContext) -> dict:
        """
        Main webhook handler entry point.
        
        Override this method or use topic-specific handlers.
        """
        topic = context.topic
        
        # Try topic-specific handler first
        handler_name = f"handle_{topic.replace('.', '_')}"
        handler = getattr(self, handler_name, None)
        
        if handler and callable(handler):
            return handler(context)
        
        # Fall back to generic handlers
        if topic.endswith('.deleted'):
            return self.handle_delete(context)
        elif topic.endswith('.created') or topic.endswith('.updated'):
            return self.handle_upsert(context)
        else:
            logger.warning(f"No handler for topic: {topic}")
            return {'detail': f'No handler for topic: {topic}'}
    
    def handle_upsert(self, context: WebhookContext) -> dict:
        """
        Handle create/update webhooks.
        
        Override to implement upsert logic.
        """
        raise NotImplementedError("Subclass must implement handle_upsert")
    
    def handle_delete(self, context: WebhookContext) -> dict:
        """
        Handle delete webhooks.
        
        Override to implement delete logic.
        """
        raise NotImplementedError("Subclass must implement handle_delete")
    
    @classmethod
    def register_with_registry(cls, registry=None):
        """
        Register this handler with the webhook registry.
        
        Call this during app initialization.
        """
        registry = registry or webhook_registry
        
        if not cls.WEBHOOK_TOPICS:
            logger.warning(f"{cls.__name__} has no WEBHOOK_TOPICS defined")
            return
        
        registry.register_service(
            service_class=cls,
            topics=cls.WEBHOOK_TOPICS,
            method_name='handle_webhook',
            name=cls.__name__
        )
        
        logger.info(f"Registered {cls.__name__} for topics: {cls.WEBHOOK_TOPICS}")


class WebhookViewMixin:
    """
    Mixin for webhook API views.
    
    Provides common functionality for webhook endpoints.
    
    Usage:
        class ProductWebhookView(WebhookViewMixin, APIView):
            permission_classes = [AllowAny]
            
            def post(self, request):
                return self.dispatch_webhook(request)
    """
    
    _validator: Optional[WebhookValidator] = None
    
    @property
    def validator(self) -> WebhookValidator:
        """Lazy-initialized webhook validator."""
        if self._validator is None:
            self._validator = WebhookValidator()
        return self._validator
    
    def validate_and_get_context(self, request) -> WebhookContext:
        """
        Validate webhook and return context.
        
        Raises:
            WebhookValidationError: If validation fails
        """
        return self.validator.validate(request)
    
    def dispatch_webhook(self, request) -> Response:
        """
        Validate and dispatch webhook to registry.
        
        Use this for a fully automated dispatch flow.
        """
        from .dispatcher import webhook_dispatcher
        return webhook_dispatcher.dispatch(request)
    
    def is_ping_webhook(self, context: WebhookContext) -> bool:
        """Check if this is a ping/test webhook."""
        return self.validator.is_ping(context)
    
    def success_response(self, context: WebhookContext, data: dict = None) -> Response:
        """Build a success response."""
        response_data = {
            'detail': 'Webhook processed successfully',
            'topic': context.topic,
        }
        if data:
            response_data.update(data)
        return Response(response_data)
    
    def error_response(
        self,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        **kwargs
    ) -> Response:
        """Build an error response."""
        return Response(
            {'detail': message, **kwargs},
            status=status_code
        )

"""
LkSystem Core Webhooks - Dispatcher
Central webhook dispatcher with validation and routing.
"""

import logging
from typing import Any, Dict, Optional
from dataclasses import dataclass

from rest_framework import status
from rest_framework.response import Response

from core.services.exceptions import (
    WebhookValidationError,
    WebhookDispatchError,
    WooCommerceBaseError,
)
from .validators import WebhookValidator, WebhookContext
from .registry import webhook_registry, WebhookRegistry

logger = logging.getLogger(__name__)


@dataclass
class DispatchResult:
    """Result of webhook dispatch operation."""
    success: bool
    topic: str
    message: str
    data: Optional[Dict] = None
    error: Optional[str] = None


class WebhookDispatcher:
    """
    Central dispatcher for WooCommerce webhooks.
    
    Combines validation and routing in a single entry point.
    Handles errors gracefully and returns appropriate responses.
    
    Usage:
        dispatcher = WebhookDispatcher()
        response = dispatcher.dispatch(request)
    """
    
    def __init__(
        self,
        registry: WebhookRegistry = None,
        validator: WebhookValidator = None
    ):
        """
        Initialize dispatcher.
        
        Args:
            registry: Webhook handler registry (uses global by default)
            validator: Webhook validator (creates new by default)
        """
        self.registry = registry or webhook_registry
        self.validator = validator or WebhookValidator()
    
    def dispatch(self, request) -> Response:
        """
        Validate and dispatch a webhook request.
        
        Args:
            request: Django/DRF request object
            
        Returns:
            DRF Response with appropriate status
        """
        context: Optional[WebhookContext] = None
        
        try:
            # Validate webhook
            context = self.validator.validate(request)
            
            # Handle ping/test webhooks
            if self.validator.is_ping(context):
                return Response({
                    'detail': 'Webhook ping received',
                    'status': 'ok'
                })
            
            # Check if handler exists
            if not self.registry.has_handler(context.topic):
                logger.warning(f"No handler for webhook topic: {context.topic}")
                return Response({
                    'detail': f"Unknown topic: {context.topic}",
                    'registered_topics': self.registry.list_topics()
                }, status=status.HTTP_200_OK)  # Return 200 to prevent retries
            
            # Dispatch to handler
            result = self.registry.dispatch(context)
            
            # Build response
            return self._build_success_response(context, result)
            
        except WebhookValidationError as e:
            logger.warning(f"Webhook validation failed: {e.message}")
            return Response(
                e.to_dict(),
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        except WebhookDispatchError as e:
            logger.error(f"Webhook dispatch failed: {e.message}")
            return Response(
                e.to_dict(),
                status=status.HTTP_400_BAD_REQUEST
            )
        
        except WooCommerceBaseError as e:
            logger.error(f"WooCommerce error during webhook: {e.message}")
            return Response(
                e.to_dict(),
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        except Exception as e:
            logger.exception(f"Unexpected error processing webhook: {e}")
            return Response({
                'error': 'InternalError',
                'message': 'Internal error processing webhook',
                'topic': context.topic if context else 'unknown'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _build_success_response(
        self,
        context: WebhookContext,
        result: Any
    ) -> Response:
        """Build success response from handler result."""
        # If handler returned a Response, use it directly
        if isinstance(result, Response):
            return result
        
        # If handler returned a dict, wrap it
        if isinstance(result, dict):
            return Response({
                'detail': 'Webhook processed successfully',
                'topic': context.topic,
                **result
            })
        
        # If handler returned a DispatchResult
        if isinstance(result, DispatchResult):
            response_data = {
                'detail': result.message,
                'topic': result.topic,
                'success': result.success,
            }
            if result.data:
                response_data['data'] = result.data
            
            return Response(
                response_data,
                status=status.HTTP_200_OK if result.success else status.HTTP_400_BAD_REQUEST
            )
        
        # Default response
        return Response({
            'detail': 'Webhook processed successfully',
            'topic': context.topic
        })
    
    def dispatch_async(self, request) -> Response:
        """
        Acknowledge webhook immediately and process asynchronously.
        
        This is useful for long-running operations to prevent timeout.
        Requires Celery or similar task queue.
        
        Args:
            request: Django/DRF request object
            
        Returns:
            Immediate acknowledgment response
            
        Note:
            Requires Celery or similar task queue. Create a tasks.py
            file with a `process_webhook_async` task to use this method.
        """
        try:
            # Validate first
            context = self.validator.validate(request)
            
            # Handle ping immediately
            if self.validator.is_ping(context):
                return Response({'detail': 'Webhook ping received'})
            
            # Queue for async processing
            # NOTE: Requires tasks.py with Celery task
            try:
                from .tasks import process_webhook_async
                process_webhook_async.delay(
                    topic=context.topic,
                    payload=context.payload,
                    sales_channel_id=context.sales_channel.id,
                    delivery_id=context.delivery_id
                )
            except ImportError:
                # Fall back to synchronous processing if Celery not configured
                logger.warning("Async tasks not configured, processing synchronously")
                self.registry.dispatch(context)
            
            return Response({
                'detail': 'Webhook queued for processing',
                'topic': context.topic,
                'delivery_id': context.delivery_id
            }, status=status.HTTP_202_ACCEPTED)
            
        except WebhookValidationError as e:
            return Response(e.to_dict(), status=status.HTTP_401_UNAUTHORIZED)
        except Exception as e:
            logger.exception(f"Error queuing webhook: {e}")
            return Response({
                'error': 'QueueError',
                'message': 'Failed to queue webhook for processing'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Global dispatcher instance
webhook_dispatcher = WebhookDispatcher()

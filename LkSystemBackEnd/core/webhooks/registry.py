"""
LkSystem Core Webhooks - Handler Registry
Registry pattern for webhook handlers.
"""

import logging
from typing import Dict, Callable, Optional, Type, Any, List
from dataclasses import dataclass, field

from .validators import WebhookContext

logger = logging.getLogger(__name__)


@dataclass
class HandlerInfo:
    """Information about a registered webhook handler."""
    handler: Callable[[WebhookContext], Any]
    topics: List[str]
    description: str = ""
    service_class: Optional[Type] = None


class WebhookRegistry:
    """
    Central registry for webhook handlers.
    
    Implements the registry pattern to allow dynamic registration
    of handlers for different webhook topics.
    
    Usage:
        # Register a handler
        registry = WebhookRegistry()
        
        @registry.register('product.created', 'product.updated')
        def handle_product(context: WebhookContext):
            ...
        
        # Or register a service class
        registry.register_service(ProductService, ['product.created', 'product.updated'])
        
        # Dispatch a webhook
        result = registry.dispatch(context)
    """
    
    def __init__(self):
        self._handlers: Dict[str, HandlerInfo] = {}
        self._topic_map: Dict[str, str] = {}  # topic -> handler_name
    
    def register(self, *topics: str, name: str = None, description: str = ""):
        """
        Decorator to register a webhook handler function.
        
        Args:
            *topics: Webhook topics this handler handles
            name: Optional handler name (defaults to function name)
            description: Handler description
            
        Example:
            @registry.register('product.created', 'product.updated')
            def handle_product(context: WebhookContext):
                ...
        """
        def decorator(func: Callable[[WebhookContext], Any]):
            handler_name = name or func.__name__
            
            info = HandlerInfo(
                handler=func,
                topics=list(topics),
                description=description or func.__doc__ or ""
            )
            
            self._handlers[handler_name] = info
            
            for topic in topics:
                if topic in self._topic_map:
                    logger.warning(
                        f"Overwriting handler for topic '{topic}': "
                        f"{self._topic_map[topic]} -> {handler_name}"
                    )
                self._topic_map[topic] = handler_name
            
            logger.debug(f"Registered handler '{handler_name}' for topics: {topics}")
            return func
        
        return decorator
    
    def register_handler(
        self,
        handler: Callable[[WebhookContext], Any],
        topics: List[str],
        name: str = None,
        description: str = ""
    ) -> None:
        """
        Programmatically register a handler function.
        
        Args:
            handler: Handler function
            topics: List of topics to handle
            name: Handler name
            description: Handler description
        """
        handler_name = name or handler.__name__
        
        info = HandlerInfo(
            handler=handler,
            topics=topics,
            description=description
        )
        
        self._handlers[handler_name] = info
        
        for topic in topics:
            self._topic_map[topic] = handler_name
        
        logger.debug(f"Registered handler '{handler_name}' for topics: {topics}")
    
    def register_service(
        self,
        service_class: Type,
        topics: List[str],
        method_name: str = 'handle_webhook',
        name: str = None
    ) -> None:
        """
        Register a service class as a webhook handler.
        
        The service class must have a method matching `method_name`
        that accepts a WebhookContext.
        
        Args:
            service_class: Service class type
            topics: List of topics to handle
            method_name: Name of the handler method on the service
            name: Handler name (defaults to service class name)
        """
        handler_name = name or service_class.__name__
        
        def service_handler(context: WebhookContext) -> Any:
            # Instantiate service with sales channel
            service = service_class(context.sales_channel)
            
            # Call handler method
            handler_method = getattr(service, method_name)
            return handler_method(context)
        
        info = HandlerInfo(
            handler=service_handler,
            topics=topics,
            description=f"Service handler: {service_class.__name__}.{method_name}",
            service_class=service_class
        )
        
        self._handlers[handler_name] = info
        
        for topic in topics:
            self._topic_map[topic] = handler_name
        
        logger.debug(
            f"Registered service handler '{handler_name}' "
            f"({service_class.__name__}) for topics: {topics}"
        )
    
    def get_handler(self, topic: str) -> Optional[Callable]:
        """Get the handler function for a topic."""
        handler_name = self._topic_map.get(topic)
        if handler_name:
            info = self._handlers.get(handler_name)
            return info.handler if info else None
        return None
    
    def has_handler(self, topic: str) -> bool:
        """Check if a handler exists for a topic."""
        return topic in self._topic_map
    
    def list_handlers(self) -> Dict[str, HandlerInfo]:
        """Get all registered handlers."""
        return self._handlers.copy()
    
    def list_topics(self) -> List[str]:
        """Get all registered topics."""
        return list(self._topic_map.keys())
    
    def dispatch(self, context: WebhookContext) -> Any:
        """
        Dispatch a webhook to the appropriate handler.
        
        Args:
            context: Validated webhook context
            
        Returns:
            Handler result
            
        Raises:
            KeyError: If no handler is registered for the topic
        """
        topic = context.topic
        handler = self.get_handler(topic)
        
        if handler is None:
            raise KeyError(f"No handler registered for topic: {topic}")
        
        logger.info(f"Dispatching webhook topic '{topic}' to handler")
        return handler(context)


# Global registry instance
webhook_registry = WebhookRegistry()

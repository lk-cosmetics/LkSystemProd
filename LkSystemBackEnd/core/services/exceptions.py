"""
LkSystem Core Services - Custom Exceptions
Centralized exception hierarchy for WooCommerce operations.
"""


class WooCommerceBaseError(Exception):
    """Base exception for all WooCommerce-related errors."""
    
    def __init__(self, message: str, details: dict = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self) -> dict:
        """Convert exception to dictionary for API responses."""
        return {
            'error': self.__class__.__name__,
            'message': self.message,
            'details': self.details,
        }


class WooCommerceConfigError(WooCommerceBaseError):
    """
    Raised when WooCommerce configuration is invalid or missing.
    
    Examples:
        - Missing store_url, consumer_key, or consumer_secret
        - Invalid URL format
        - Missing webhook_token
    """
    pass


class WooCommerceAuthError(WooCommerceBaseError):
    """
    Raised when WooCommerce authentication fails.
    
    Examples:
        - Invalid API credentials
        - Expired tokens
        - Insufficient permissions
    """
    
    def __init__(self, message: str, status_code: int = 401, details: dict = None):
        self.status_code = status_code
        super().__init__(message, details)


class WooCommerceAPIError(WooCommerceBaseError):
    """
    Raised when WooCommerce API returns an error response.
    
    Attributes:
        status_code: HTTP status code from WooCommerce
        response_body: Raw response body for debugging
    """
    
    def __init__(
        self,
        message: str,
        status_code: int = None,
        response_body: str = None,
        details: dict = None
    ):
        self.status_code = status_code
        self.response_body = response_body
        super().__init__(message, details)
    
    def to_dict(self) -> dict:
        result = super().to_dict()
        result['status_code'] = self.status_code
        return result


class WooCommerceSyncError(WooCommerceBaseError):
    """
    Raised when synchronization operations fail.
    
    Examples:
        - Failed to upsert product/category
        - Relationship resolution failed
        - Data transformation error
    """
    
    def __init__(
        self,
        message: str,
        entity_type: str = None,
        entity_id: int = None,
        details: dict = None
    ):
        self.entity_type = entity_type
        self.entity_id = entity_id
        super().__init__(message, details)
    
    def to_dict(self) -> dict:
        result = super().to_dict()
        result['entity_type'] = self.entity_type
        result['entity_id'] = self.entity_id
        return result


class WebhookValidationError(WooCommerceBaseError):
    """
    Raised when webhook validation fails.
    
    Examples:
        - Invalid signature
        - Missing required headers
        - Unknown webhook source
    """
    
    def __init__(self, message: str, header_name: str = None, details: dict = None):
        self.header_name = header_name
        super().__init__(message, details)


class WebhookDispatchError(WooCommerceBaseError):
    """
    Raised when webhook cannot be dispatched to a handler.
    
    Examples:
        - Unknown topic
        - Handler not registered
        - Handler execution failed
    """
    
    def __init__(self, message: str, topic: str = None, details: dict = None):
        self.topic = topic
        super().__init__(message, details)

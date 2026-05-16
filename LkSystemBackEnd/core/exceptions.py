"""
LkSystem Custom Exception Handler
Provides detailed error logging for API requests.
"""

import logging
from rest_framework.views import exception_handler
from rest_framework.exceptions import APIException

logger = logging.getLogger('rest_framework')


def custom_exception_handler(exc, context):
    """
    Custom exception handler that logs detailed error information.
    """
    # Call REST framework's default exception handler first
    response = exception_handler(exc, context)
    
    # Get request info for logging
    request = context.get('request')
    view = context.get('view')
    
    # Build log message with details
    method = request.method if request else 'UNKNOWN'
    path = request.path if request else 'UNKNOWN'
    view_name = view.__class__.__name__ if view else 'UNKNOWN'
    
    if response is not None:
        # Log the error with full details
        error_data = response.data
        status_code = response.status_code
        
        # Format error message
        log_message = (
            f"\n{'='*60}\n"
            f"API ERROR DETAILS\n"
            f"{'='*60}\n"
            f"Status Code: {status_code}\n"
            f"Method: {method}\n"
            f"Path: {path}\n"
            f"View: {view_name}\n"
            f"Error: {error_data}\n"
        )
        
        # Safely try to add request data (may fail if parse error)
        try:
            if request and hasattr(request, '_request'):
                # Get raw body for logging (useful when JSON parse fails)
                raw_body = getattr(request._request, 'body', b'')
                if raw_body:
                    log_message += f"Raw Body: {raw_body[:500]}\n"  # Limit to 500 chars
        except Exception:
            pass  # Ignore errors when trying to get request data
        
        log_message += f"{'='*60}"
        
        # Log based on status code
        if status_code >= 500:
            logger.error(log_message)
        elif status_code >= 400:
            logger.warning(log_message)
        else:
            logger.info(log_message)
        
        # Add extra context to response for debugging (optional)
        if isinstance(response.data, dict):
            response.data['status_code'] = status_code
    else:
        # Unhandled exception - log as error
        logger.exception(
            f"\n{'='*60}\n"
            f"UNHANDLED EXCEPTION\n"
            f"{'='*60}\n"
            f"Method: {method}\n"
            f"Path: {path}\n"
            f"View: {view_name}\n"
            f"Exception: {exc}\n"
            f"{'='*60}"
        )
    
    return response

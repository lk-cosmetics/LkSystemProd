"""
LkSystem Core Package
"""

# Bootstrap Celery when Django starts so @shared_task decorators work correctly.
# Celery is optional — if not installed the import is silently skipped.
try:
    from .celery import app as celery_app
    __all__ = ('celery_app',)
except ImportError:
    pass

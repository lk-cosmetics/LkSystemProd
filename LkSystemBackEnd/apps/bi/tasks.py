"""
BI Celery tasks.

Mirrors the graceful-degradation pattern from ``apps/orders/tasks.py``:
when Celery is unavailable the decorated function exposes ``.delay()`` and
``.apply_async()`` that run inline. This keeps signals working in dev/test
without a worker.
"""

from __future__ import annotations

import logging

from apps.bi import cache as bi_cache
from apps.bi.services import (
    recompute_for_company_brand_date,
    recompute_range as svc_recompute_range,
)

logger = logging.getLogger(__name__)


def _get_celery_app():
    try:
        from core.celery import app
        return app
    except ImportError:
        return None


celery_app = _get_celery_app()


def _task(**kwargs):
    def decorator(func):
        if celery_app is not None:
            return celery_app.task(**kwargs)(func)
        func.delay = lambda *a, **kw: func(*a, **kw)
        func.apply_async = lambda args=(), kwargs={}, **opts: func(*args, **kwargs)
        return func
    return decorator


@_task(name='bi.recompute_for_bucket')
def recompute_for_bucket(company_id: int, brand_id: int, day: str) -> None:
    """Recompute one (company, brand, date) bucket and bust the cache."""

    try:
        recompute_for_company_brand_date(company_id, brand_id, day)
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception('BI recompute failed for %s/%s/%s: %s',
                         company_id, brand_id, day, exc)
        return
    bi_cache.invalidate_for(company_id, brand_id)


@_task(name='bi.recompute_range')
def recompute_range(company_id: int, brand_id: int, start: str, end: str) -> int:
    """Recompute every day in [start, end]. Returns processed day count."""

    count = svc_recompute_range(company_id, brand_id, start, end)
    bi_cache.invalidate_for(company_id, brand_id)
    return count


@_task(name='bi.invalidate_cache')
def invalidate_cache(company_id, brand_id) -> None:
    bi_cache.invalidate_for(company_id, brand_id)

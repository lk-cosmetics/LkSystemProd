"""
Redis cache helpers for BI dashboard responses.

Uses Django's cache (already configured against Redis in ``core.settings``).
TTL is short (60s) — Celery-driven invalidation handles the heavy lifting on
order changes; the TTL only protects against stale reads when the worker is
briefly behind.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Optional

from django.core.cache import cache

logger = logging.getLogger(__name__)


BI_CACHE_TTL = 60  # seconds


def _norm(value) -> str:
    if value is None:
        return 'all'
    return str(value)


def build_key(
    kind: str,
    *,
    company_id,
    brand_id,
    period: str,
    start_date=None,
    end_date=None,
) -> str:
    """
    Build a stable cache key.

    For predefined periods the date suffix is empty so existing keys stay
    the same. ``period='custom'`` appends the explicit window so two custom
    ranges don't share a cache entry.

    Example:
        dashboard:summary:company:7:brand:12:period:30d
        dashboard:summary:company:7:brand:12:period:custom:s:2026-01-01:e:2026-02-15
    """

    suffix = ''
    if period == 'custom' and (start_date or end_date):
        suffix = f':s:{_norm(start_date)}:e:{_norm(end_date)}'
    return (
        f'dashboard:{kind}'
        f':company:{_norm(company_id)}'
        f':brand:{_norm(brand_id)}'
        f':period:{period}{suffix}'
    )


def get_or_set(key: str, compute: Callable[[], Any], ttl: int = BI_CACHE_TTL) -> Any:
    """Read from cache, fall back to ``compute()`` and store the value."""

    try:
        cached = cache.get(key)
    except Exception:
        # IGNORE_EXCEPTIONS=True is set, but be extra defensive
        cached = None

    if cached is not None:
        return cached

    value = compute()
    try:
        cache.set(key, value, ttl)
    except Exception as exc:  # pragma: no cover — cache must never break reads
        logger.warning('BI cache write failed for %s: %s', key, exc)
    return value


def invalidate_keys(keys: Iterable[str]) -> None:
    try:
        cache.delete_many(list(keys))
    except Exception as exc:  # pragma: no cover
        logger.warning('BI cache invalidate failed: %s', exc)


def invalidate_for(company_id: Optional[int], brand_id: Optional[int]) -> None:
    """
    Invalidate all cached dashboard responses for a (company, brand) combo
    across every period. Called after stats are recomputed.

    Uses pattern-delete (django-redis) when available so that keys with extra
    suffixes (e.g. ``:limit:N`` on top-products) are also cleared.
    """

    periods = ('7d', '30d', '3m', 'ytd')
    kinds = (
        'summary', 'sales_chart', 'sales_channels',
        'sales_channel_chart', 'resale_types',
        'top_products', 'trending_products',
    )

    # Try pattern delete first (django-redis). Falls back to exact-key delete
    # if the backend doesn't support patterns.
    patterns = []
    keys = []
    for kind in kinds:
        for p in periods:
            for cid in (company_id, None):
                for bid in (brand_id, None):
                    base = build_key(kind, company_id=cid, brand_id=bid, period=p)
                    keys.append(base)
                    patterns.append(f'{base}*')

    try:
        for pattern in patterns:
            cache.delete_pattern(pattern)  # type: ignore[attr-defined]
        return
    except (AttributeError, Exception) as exc:  # pragma: no cover — fallback
        logger.debug('BI cache pattern delete unavailable (%s) — using exact keys', exc)
        invalidate_keys(keys)

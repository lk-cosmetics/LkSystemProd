"""
LkSystem Orders — request-input validators / coercers.

Small, stateless helpers that turn raw, untrusted query-string and body values
(always strings, often missing) into safe typed values with sane fallbacks.
They live here rather than on the viewset so request parsing is uniform and
testable, and so the viewset reads as request→service wiring.

Field-level validation of *write* payloads stays in the DRF serializers (that is
their job); this module is only for the loose ``request.query_params`` /
``request.data`` scalars the read + sync actions accept.
"""

from __future__ import annotations

_TRUTHY = {'1', 'true', 'yes', 'y', 'on'}


def safe_int(value, default):
    """Coerce to ``int``; return ``default`` on missing/garbage input."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_positive_int(value, default: int, *, maximum: int | None = None) -> int:
    """Coerce to an ``int`` clamped to ``[1, maximum]`` (1+ when no maximum).

    Used for pagination-style params where zero/negative/oversized values must
    be tamed rather than rejected.
    """
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    parsed = max(1, parsed)
    return min(parsed, maximum) if maximum else parsed


def safe_bool(value, default: bool = False) -> bool:
    """Coerce a flag param to ``bool``; accepts 1/true/yes/y/on (any case)."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in _TRUTHY

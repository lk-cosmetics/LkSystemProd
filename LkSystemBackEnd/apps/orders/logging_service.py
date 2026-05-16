"""Centralized audit logging helpers for orders."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from .models import OrderLog


class OrderLoggingService:
    """Single entry point for creating order audit logs."""

    @staticmethod
    def _to_json_safe(value: Any) -> Any:
        """Recursively convert values into JSON-serializable primitives."""
        if isinstance(value, Decimal):
            return str(value)

        if isinstance(value, (datetime, date)):
            return value.isoformat()

        if isinstance(value, dict):
            return {
                str(k): OrderLoggingService._to_json_safe(v)
                for k, v in value.items()
            }

        if isinstance(value, (list, tuple, set)):
            return [OrderLoggingService._to_json_safe(v) for v in value]

        return value

    @staticmethod
    def log(*, order, action: str, user=None, details: dict[str, Any] | None = None) -> OrderLog:
        return OrderLog.objects.create(
            order=order,
            action=action,
            user=user,
            details=OrderLoggingService._to_json_safe(details or {}),
        )

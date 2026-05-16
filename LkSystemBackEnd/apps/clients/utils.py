"""Client utility helpers shared by POS, WooCommerce import, and APIs."""

from __future__ import annotations


def normalize_tunisian_phone(value: str | None) -> str:
    """Return a stable 8-digit Tunisian phone key when possible.

    Examples:
      +21624512995 -> 24512995
      0021624512995 -> 24512995
      24512995 -> 24512995
    """
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if digits.startswith('00216') and len(digits) >= 13:
        digits = digits[5:]
    elif digits.startswith('216') and len(digits) >= 11:
        digits = digits[3:]
    if len(digits) > 8:
        digits = digits[-8:]
    return digits

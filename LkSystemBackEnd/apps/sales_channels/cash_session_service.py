"""Auditable daily POS cash-register sessions and financial summaries."""

from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import transaction
from django.db.models import Case, DecimalField, F, Q, Sum, Value, When
from django.utils import timezone

from .models import CashMovement, CashSession, SalesChannel


MONEY_QUANTUM = Decimal("0.001")
ZERO = Decimal("0.000")


class CashSessionError(Exception):
    """A user-facing cash-session business rule violation."""


def money(value, *, field="amount") -> Decimal:
    try:
        result = Decimal(str(value)).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CashSessionError(f"{field} must be a valid amount.") from exc
    if result < ZERO:
        raise CashSessionError(f"{field} cannot be negative.")
    return result


class CashSessionService:
    """Single source of truth for POS business dates and drawer calculations."""

    @staticmethod
    def business_timezone():
        name = getattr(settings, "POS_BUSINESS_TIME_ZONE", "Africa/Tunis")
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError:  # pragma: no cover - deployment safeguard
            return ZoneInfo("UTC")

    @classmethod
    def business_date(cls, moment=None):
        current = moment or timezone.now()
        return current.astimezone(cls.business_timezone()).date()

    @classmethod
    def day_bounds(cls, day):
        tz = cls.business_timezone()
        start = datetime.combine(day, time.min, tzinfo=tz)
        return start, start + timedelta(days=1)

    @staticmethod
    def _register_filter(channel):
        from apps.orders.models import Order

        return Q(pos_sales_channel=channel) | Q(
            source=Order.Source.POS,
            sales_channel=channel,
        )

    @classmethod
    def summarize(cls, channel: SalesChannel, day, *, session=None):
        """Return one day's sales, refunds, movements, and drawer balance.

        Sales are recorded on ``pos_validated_at`` even if the order is returned
        later. The refund is a separate event on ``returned_at``. This preserves
        historical turnover instead of rewriting the original sale day.
        """
        from apps.orders.models import Order

        start, end = cls.day_bounds(day)
        register_filter = cls._register_filter(channel)
        amount_field = DecimalField(max_digits=14, decimal_places=3)
        cash_method = Q(payment_method__iexact="cash") | Q(payment_method="")

        sales = Order.objects.filter(
            register_filter,
            pos_validated_at__gte=start,
            pos_validated_at__lt=end,
            payment_status=Order.PaymentStatus.PAID,
            is_deleted=False,
        )
        gross_sales = sales.aggregate(total=Sum("total"))["total"] or ZERO
        cash_sales = sales.aggregate(total=Sum(Case(
            When(payment_method__iexact="split", then=F("cash_amount")),
            When(cash_method, then=F("total")),
            default=Value(ZERO),
            output_field=amount_field,
        )))["total"] or ZERO
        card_sales = sales.aggregate(total=Sum(Case(
            When(payment_method__iexact="split", then=F("card_amount")),
            When(cash_method, then=Value(ZERO)),
            default=F("total"),
            output_field=amount_field,
        )))["total"] or ZERO

        returned = Order.objects.filter(
            register_filter,
            returned_at__gte=start,
            returned_at__lt=end,
            pos_validated_at__isnull=False,
            is_deleted=False,
        )
        cash_returned = returned.aggregate(total=Sum(Case(
            When(payment_method__iexact="split", then=F("cash_amount")),
            When(cash_method, then=F("total")),
            default=Value(ZERO),
            output_field=amount_field,
        )))["total"] or ZERO
        card_returned = returned.aggregate(total=Sum(Case(
            When(payment_method__iexact="split", then=F("card_amount")),
            When(cash_method, then=Value(ZERO)),
            default=F("total"),
            output_field=amount_field,
        )))["total"] or ZERO

        movements = CashMovement.objects.filter(
            sales_channel=channel,
            occurred_at__gte=start,
            occurred_at__lt=end,
            is_deleted=False,
        )
        deposits = movements.filter(movement_type=CashMovement.Type.DEPOSIT)
        expenses = movements.filter(movement_type=CashMovement.Type.EXPENSE)
        legacy_opening = (
            deposits.filter(category="OPENING").aggregate(total=Sum("amount"))["total"]
            or ZERO
        )
        manual_cash_in = (
            deposits.exclude(category="OPENING").aggregate(total=Sum("amount"))["total"]
            or ZERO
        )
        manual_refunds = (
            expenses.filter(category="REFUND").aggregate(total=Sum("amount"))["total"]
            or ZERO
        )
        manual_cash_out = (
            expenses.exclude(category="REFUND").aggregate(total=Sum("amount"))["total"]
            or ZERO
        )

        opening = session.opening_cash if session else legacy_opening
        cash_refunds = cash_returned + manual_refunds
        card_refunds = card_returned
        refunds = cash_refunds + card_refunds
        net_sales = gross_sales - refunds
        expected_cash_live = (
            opening + cash_sales + manual_cash_in - cash_refunds - manual_cash_out
        )
        expected_cash = (
            session.closing_cash_expected
            if session and session.status == CashSession.Status.CLOSED
            and session.closing_cash_expected is not None
            else expected_cash_live
        )

        return {
            "gross_sales": gross_sales,
            "revenue": net_sales,
            "revenue_count": sales.count(),
            "cash_sales": cash_sales,
            "card_sales": card_sales,
            "cash_refunds": cash_refunds,
            "card_refunds": card_refunds,
            "refunds": refunds,
            "opening": opening,
            "cash_added": manual_cash_in,
            "manual_cash_in": manual_cash_in,
            "manual_cash_out": manual_cash_out,
            "funding_total": opening + manual_cash_in,
            "funding_count": deposits.count(),
            "expenses": manual_cash_out + manual_refunds,
            "expenses_count": expenses.count(),
            "net_balance": net_sales - manual_cash_out,
            "cash_balance": expected_cash,
            "expected_cash_live": expected_cash_live,
            "by_category": list(
                expenses.values("category").annotate(total=Sum("amount")).order_by("-total")
            ),
        }

    @classmethod
    @transaction.atomic
    def ensure_open(cls, channel: SalesChannel, *, actor=None, moment=None):
        day = cls.business_date(moment)
        session, _created = CashSession.objects.select_for_update().get_or_create(
            sales_channel=channel,
            business_date=day,
            defaults={
                "company_id": channel.brand.company_id,
                "opening_cash": ZERO,
                "opening_cash_set": False,
                "opened_at": moment or timezone.now(),
                "opened_by": actor,
            },
        )
        if session.status == CashSession.Status.CLOSED:
            raise CashSessionError(
                "La caisse du jour est clôturée. Aucune nouvelle opération financière n'est autorisée."
            )
        return session

    @classmethod
    @transaction.atomic
    def open(cls, channel: SalesChannel, *, opening_cash, actor=None):
        amount = money(opening_cash, field="opening_cash")
        session = cls.ensure_open(channel, actor=actor)
        session = CashSession.objects.select_for_update().get(pk=session.pk)
        if session.opening_cash_set:
            raise CashSessionError("Le fond de caisse a déjà été confirmé pour cette journée.")
        session.opening_cash = amount
        session.opening_cash_set = True
        session.opened_at = timezone.now()
        session.opened_by = actor
        session.save(update_fields=[
            "opening_cash", "opening_cash_set", "opened_at", "opened_by", "updated_at",
        ])
        return session

    @classmethod
    @transaction.atomic
    def close(cls, session: CashSession, *, actual_cash, note="", actor=None):
        session = CashSession.objects.select_for_update().select_related(
            "sales_channel", "sales_channel__brand",
        ).get(pk=session.pk)
        if session.status == CashSession.Status.CLOSED:
            raise CashSessionError("Cette caisse est déjà clôturée.")
        if session.business_date != cls.business_date():
            raise CashSessionError("Seule la caisse du jour peut être clôturée.")

        actual = money(actual_cash, field="closing_cash_actual")
        summary = cls.summarize(
            session.sales_channel,
            session.business_date,
            session=session,
        )
        expected = summary["expected_cash_live"].quantize(MONEY_QUANTUM)
        session.closing_cash_expected = expected
        session.closing_cash_actual = actual
        session.cash_difference = (actual - expected).quantize(MONEY_QUANTUM)
        session.closing_note = (note or "").strip()
        session.closed_at = timezone.now()
        session.closed_by = actor
        session.status = CashSession.Status.CLOSED
        session.save(update_fields=[
            "closing_cash_expected", "closing_cash_actual", "cash_difference",
            "closing_note", "closed_at", "closed_by", "status", "updated_at",
        ])
        return session

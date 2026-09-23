"""POS payment validation and persistence.

The frontend guides the cashier, but this service remains the authoritative
guard against underpayment, invalid split allocations, and negative amounts.
It is shared by direct POS sales and orders routed to a POS checkout.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from apps.orders.models import Order


MONEY_QUANTUM = Decimal('0.001')


class POSPaymentError(Exception):
    pass


class POSPaymentService:
    CASH = 'cash'
    CARD = 'card'
    SPLIT = 'split'
    BANK_TRANSFER = 'bank_transfer'

    @staticmethod
    def _money(value, *, default=None):
        if value in (None, ''):
            return default
        try:
            amount = Decimal(str(value)).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise POSPaymentError('Payment amounts must be valid numbers.') from exc
        if amount < 0:
            raise POSPaymentError('Payment amounts cannot be negative.')
        return amount

    @classmethod
    def apply(
        cls,
        order: Order,
        *,
        payment_method: str,
        cash_amount=None,
        card_amount=None,
        amount_received=None,
    ) -> Order:
        """Validate a tender against the server-computed order total and save it."""
        method = (payment_method or cls.CASH).strip().lower().replace(' ', '_')
        aliases = {
            'cash_+_card': cls.SPLIT,
            'cash_card': cls.SPLIT,
            'card_+_cash': cls.SPLIT,
            'espèces': cls.CASH,
            'especes': cls.CASH,
            'carte': cls.CARD,
        }
        method = aliases.get(method, method)
        if method not in {cls.CASH, cls.CARD, cls.SPLIT, cls.BANK_TRANSFER}:
            raise POSPaymentError('Unsupported payment method.')

        total = cls._money(order.total, default=Decimal('0.000'))
        cash = cls._money(cash_amount)
        card = cls._money(card_amount)
        received = cls._money(amount_received)

        if method == cls.CASH:
            if card not in (None, Decimal('0.000')):
                raise POSPaymentError('Card amount must be zero for a cash payment.')
            cash = total
            received = total if received is None else received
            if received < total:
                raise POSPaymentError('Amount received is lower than the order total.')
            card = Decimal('0.000')
            change = received - total

        elif method == cls.CARD:
            if cash not in (None, Decimal('0.000')) or received not in (None, Decimal('0.000')):
                raise POSPaymentError('Cash amounts must be zero for a card payment.')
            cash = Decimal('0.000')
            card = total
            received = Decimal('0.000')
            change = Decimal('0.000')

        elif method == cls.SPLIT:
            if cash is None and card is None:
                raise POSPaymentError('Enter a cash or card amount for split payment.')
            if cash is None:
                cash = total - card
            if card is None:
                card = total - cash
            if cash <= 0 or card <= 0:
                raise POSPaymentError('Split payment requires both cash and card amounts.')
            if (cash + card).quantize(MONEY_QUANTUM) != total:
                raise POSPaymentError('Cash and card amounts must equal the order total.')
            received = cash if received is None else received
            if received < cash:
                raise POSPaymentError('Cash received is lower than the cash portion.')
            change = received - cash

        else:  # Legacy bank-transfer compatibility.
            cash = Decimal('0.000')
            card = Decimal('0.000')
            received = Decimal('0.000')
            change = Decimal('0.000')

        order.payment_method = method
        order.payment_status = Order.PaymentStatus.PAID
        order.cash_amount = cash
        order.card_amount = card
        order.amount_received = received
        order.change_returned = change.quantize(MONEY_QUANTUM)
        order.save(update_fields=[
            'payment_method', 'payment_status', 'cash_amount', 'card_amount',
            'amount_received', 'change_returned', 'updated_at',
        ])
        return order

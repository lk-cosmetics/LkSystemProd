"""
LkSystem Orders App - FilterSets
Define explicit filtersets for better schema generation support.
"""

import django_filters
from django.db.models import Q

from .models import Order, OrderLine


class OrderFilterSet(django_filters.FilterSet):
    """Explicit FilterSet for Order model."""

    brand = django_filters.NumberFilter(field_name='sales_channel__brand')
    flow = django_filters.CharFilter(method='filter_flow')
    # Phase 2 — filter by the 10-state main workflow status.
    workflow_status = django_filters.CharFilter(field_name='workflow_status')
    # Phase D — filter by the clean derived ``order_status`` (the single
    # canonical lifecycle status the list surface speaks).
    order_status = django_filters.CharFilter(method='filter_order_status')
    pos_sales_channel = django_filters.NumberFilter(field_name='pos_sales_channel')
    created_from = django_filters.DateFilter(field_name='created_at', lookup_expr='date__gte')
    created_to = django_filters.DateFilter(field_name='created_at', lookup_expr='date__lte')
    created_date = django_filters.DateFilter(field_name='created_at', lookup_expr='date')

    # Phase 2 — UI workflow tabs map 1:1 to Order.WorkflowStatus values.
    _WORKFLOW_FLOW_MAP = {
        'pending':          Order.WorkflowStatus.PENDING,
        'answered':         Order.WorkflowStatus.ANSWERED,
        'not_answered':     Order.WorkflowStatus.NOT_ANSWERED,
        'sent_to_delivery': Order.WorkflowStatus.SENT_TO_DELIVERY,
        'packaging':        Order.WorkflowStatus.PACKAGING,
        'retour':           Order.WorkflowStatus.RETOUR,
        'changed':          Order.WorkflowStatus.CHANGED,
    }

    @staticmethod
    def filter_order_status(queryset, _name, value):
        """Filter by the clean derived ``order_status`` (Phase D).

        Accepts a single value (``?order_status=delayed``) or a comma-separated
        group (``?order_status=new,awaiting_confirmation``) so the UI's grouped
        tabs map to a single query param. Tabs, the per-status counts
        (``order_status_kpis.by_status``) and the row badge all read this same
        field, so the list surface stays internally consistent.
        """
        values = [v.strip() for v in (value or '').split(',') if v.strip()]
        if not values:
            return queryset
        return queryset.filter(order_status__in=values)

    @classmethod
    def filter_flow(cls, queryset, _name, value):
        flow = (value or '').strip().lower()
        if not flow or flow == 'all':
            return queryset
        if flow == 'retour':
            return queryset.filter(
                workflow_status__in=[
                    Order.WorkflowStatus.RETOUR,
                    Order.WorkflowStatus.CHANGED,
                ],
            )
        # Direct workflow_status passthrough for the 10-state UI tabs.
        if flow in cls._WORKFLOW_FLOW_MAP:
            return queryset.filter(workflow_status=cls._WORKFLOW_FLOW_MAP[flow])

        if flow == 'needs_confirmation':
            return queryset.filter(
                outcome=Order.Outcome.NONE,
            ).exclude(
                source=Order.Source.POS,
            ).filter(
                status__in=[
                    Order.Status.PENDING,
                    Order.Status.PROCESSING,
                    Order.Status.ON_HOLD,
                    Order.Status.COMPLETED,
                ],
            )
        if flow == 'delayed':
            return queryset.filter(outcome=Order.Outcome.DELAYED)
        if flow == 'ready_delivery':
            return queryset.filter(
                outcome=Order.Outcome.CONFIRMED,
                in_store_pickup=False,
            ).exclude(
                source=Order.Source.POS,
            ).filter(
                delivery_status__in=[
                    Order.DeliveryStatus.NONE,
                    Order.DeliveryStatus.PENDING,
                    Order.DeliveryStatus.FAILED,
                ],
            )
        if flow == 'pickup':
            return queryset.filter(
                in_store_pickup=True,
                pos_validated_at__isnull=True,
            )
        if flow == 'waiting_pos':
            return queryset.filter(
                in_store_pickup=True,
                sent_to_pos_at__isnull=False,
                pos_validated_at__isnull=True,
            )
        if flow == 'in_delivery':
            return queryset.filter(
                delivery_status__in=[
                    Order.DeliveryStatus.QUEUED,
                    Order.DeliveryStatus.SUBMITTED,
                    Order.DeliveryStatus.ACCEPTED,
                    Order.DeliveryStatus.IN_TRANSIT,
                ],
            )
        if flow == 'packaged':
            return queryset.filter(
                packaging_status__in=[
                    Order.PackagingStatus.PACKAGED,
                    Order.PackagingStatus.UPDATED,
                ],
                final_outcome=Order.FinalOutcome.NONE,
            )
        if flow == 'waiting_delivery_result':
            return queryset.filter(
                delivery_status__in=[
                    Order.DeliveryStatus.SUBMITTED,
                    Order.DeliveryStatus.ACCEPTED,
                    Order.DeliveryStatus.IN_TRANSIT,
                ],
                final_outcome=Order.FinalOutcome.NONE,
            )
        if flow == 'failed_delivery':
            return queryset.filter(final_outcome=Order.FinalOutcome.FAILED_DELIVERY)
        if flow == 'done':
            return queryset.filter(
                (
                    Q(final_outcome=Order.FinalOutcome.SUCCESSFUL_SALE) |
                    Q(source=Order.Source.POS, status=Order.Status.COMPLETED)
                )
                & Q(returned_at__isnull=True)
                & ~Q(delivery_status=Order.DeliveryStatus.RETURNED)
                & ~Q(delivery_status=Order.DeliveryStatus.CANCELLED)
                & ~Q(return_exchange_status__in=[
                    Order.ReturnExchangeStatus.RETURNED,
                    Order.ReturnExchangeStatus.EXCHANGED,
                ])
            )
        if flow == 'returned':
            return queryset.filter(
                Q(returned_at__isnull=False) |
                Q(delivery_status=Order.DeliveryStatus.RETURNED) |
                Q(return_exchange_status=Order.ReturnExchangeStatus.RETURNED)
            )
        if flow == 'exchanged':
            return queryset.filter(return_exchange_status=Order.ReturnExchangeStatus.EXCHANGED)
        if flow == 'cancelled':
            return queryset.filter(
                Q(outcome=Order.Outcome.CANCELLED) |
                Q(status=Order.Status.CANCELLED)
            )
        if flow == 'deleted':
            return queryset.filter(is_deleted=True)

        return queryset.none()
    
    class Meta:
        model = Order
        fields = {
            'company': ['exact'],
            'sales_channel': ['exact'],
            'status': ['exact'],
            'wc_status': ['exact'],
            'source': ['exact'],
            'payment_status': ['exact'],
            'contact_status': ['exact'],
            'return_exchange_status': ['exact'],
            'pos_sales_channel': ['exact'],
        }


class OrderLineFilterSet(django_filters.FilterSet):
    """Explicit FilterSet for OrderLine model."""
    
    class Meta:
        model = OrderLine
        fields = {
            'order': ['exact'],
            'product': ['exact'],
        }

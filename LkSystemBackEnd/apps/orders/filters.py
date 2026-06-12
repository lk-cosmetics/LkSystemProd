"""
LkSystem Orders App - FilterSets
Define explicit filtersets for better schema generation support.
"""

import django_filters

from .models import Order, OrderLine


class OrderFilterSet(django_filters.FilterSet):
    """Explicit FilterSet for Order model."""

    brand = django_filters.NumberFilter(field_name='sales_channel__brand')
    # THE canonical lifecycle filter: ?status=new|confirmed|not_answered|
    # delayed|packaging|done|returned|canceled — single value or a
    # comma-separated union. Same field the tab counts and the row badge read.
    status = django_filters.CharFilter(method='filter_status')
    pos_sales_channel = django_filters.NumberFilter(field_name='pos_sales_channel')
    created_from = django_filters.DateFilter(field_name='created_at', lookup_expr='date__gte')
    created_to = django_filters.DateFilter(field_name='created_at', lookup_expr='date__lte')
    created_date = django_filters.DateFilter(field_name='created_at', lookup_expr='date')

    @staticmethod
    def filter_status(queryset, _name, value):
        values = [v.strip() for v in (value or '').split(',') if v.strip()]
        if not values:
            return queryset
        return queryset.filter(status__in=values)

    class Meta:
        model = Order
        fields = {
            'company': ['exact'],
            'sales_channel': ['exact'],
            'wc_status': ['exact'],
            'source': ['exact'],
            'payment_status': ['exact'],
            'sync_status': ['exact'],
            'priority_level': ['exact'],
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

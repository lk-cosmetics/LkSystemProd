"""
LkSystem Notifications App - Filters

Filters operate on the per-user inbox table (``NotificationRecipient``), so
every filter combines with the implicit ``user=request.user`` scope applied by
the viewset and is backed by the leading-``user`` composite indexes.
"""

import django_filters

from apps.notifications.models import NotificationRecipient


class NotificationFilter(django_filters.FilterSet):
    is_read   = django_filters.BooleanFilter(field_name='is_read')
    category  = django_filters.CharFilter(field_name='category')
    priority  = django_filters.CharFilter(field_name='priority')
    date_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    date_to   = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')

    class Meta:
        model = NotificationRecipient
        fields = ['is_read', 'category', 'priority', 'date_from', 'date_to']

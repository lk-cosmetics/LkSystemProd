"""Clients app FilterSet definitions."""

import django_filters

from .models import Client


class ClientFilterSet(django_filters.FilterSet):
    """Explicit FilterSet for Client list endpoints."""

    class Meta:
        model = Client
        fields = {
            'company': ['exact'],
            'brand': ['exact'],
            'source': ['exact'],
            'client_type': ['exact'],
            'state': ['exact'],
            'sales_channel': ['exact'],
            'is_active': ['exact'],
            'is_blocked': ['exact'],
        }

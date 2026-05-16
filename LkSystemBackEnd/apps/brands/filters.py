"""
LkSystem Brands App - FilterSets
Define explicit filtersets for better schema generation support.
"""

import django_filters
from .models import Brand


class BrandFilterSet(django_filters.FilterSet):
    """Explicit FilterSet for Brand model."""
    
    class Meta:
        model = Brand
        fields = {
            'company': ['exact'],
        }

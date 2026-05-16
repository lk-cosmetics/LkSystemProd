"""
LkSystem Company App - Views
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from .models import Company
from .serializers import (
    CompanySerializer,
    CompanyListSerializer,
    CompanyDetailSerializer,
)


@extend_schema_view(
    list=extend_schema(
        tags=['Companies'],
        summary='List all companies',
        description='''
Returns a paginated list of all companies.

**Filters:** `is_active`, `city`  
**Search:** `name`, `legal_name`, `abbreviation`, `email`  
**Ordering:** `name`, `created_at`, `abbreviation`
''',
    ),
    create=extend_schema(
        tags=['Companies'],
        summary='Create a company',
        description='''
Create a new company. **Only `name` is required!**

### 🪄 Auto-Generated Fields
- **`legal_name`** - Auto-filled from `name` if not provided
- **`abbreviation`** - Auto-generated from company name (uppercase, max 5 chars)
  - "Hajji Company" → `HC`
  - "Société Nationale" → `SN`  
  - "Hajji" → `HJJ`

### 📝 Minimal Example
```json
{
  "name": "Hajji"
}
```

### ✨ Auto Transformations
- `abbreviation` → UPPERCASE
- `name` → Title Case
- `email` → lowercase
- `phone` → removes spaces/dashes
''',
    ),
    retrieve=extend_schema(
        tags=['Companies'],
        summary='Get company details',
        description='Retrieve detailed information about a specific company including all nested brands.',
    ),
    update=extend_schema(
        tags=['Companies'],
        summary='Update a company',
        description='''
Update all fields of an existing company.

**Note:** If you clear `abbreviation`, a new one will be auto-generated from the name.
''',
    ),
    partial_update=extend_schema(
        tags=['Companies'],
        summary='Partial update a company',
        description='''
Update specific fields of an existing company.

Only include the fields you want to change. All auto-transformations still apply.
''',
    ),
    destroy=extend_schema(
        tags=['Companies'],
        summary='Delete a company',
        description='⚠️ **Caution:** Deleting a company will cascade delete all related brands and sales channels.',
    ),
)
class CompanyViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for Company management.
    
    ## Quick Start
    Create a company with just a name - everything else is optional!
    
    ```json
    POST /api/v1/company/
    {"name": "My Company"}
    ```
    
    The system will auto-generate:
    - `legal_name` from name
    - `abbreviation` from name (unique, uppercase)
    """
    
    queryset = Company.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active', 'city']
    search_fields = ['name', 'legal_name', 'abbreviation', 'email']
    ordering_fields = ['name', 'created_at', 'abbreviation']
    ordering = ['name']
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list' or self.action == 'active':
            return CompanyListSerializer
        if self.action == 'retrieve':
            return CompanyDetailSerializer
        return CompanySerializer
    
    def get_queryset(self):
        """Optimize queryset with prefetch for nested relations."""
        queryset = super().get_queryset()
        if self.action == 'retrieve':
            queryset = queryset.prefetch_related('brands', 'brands__sales_channels')
        elif self.action == 'list':
            queryset = queryset.prefetch_related('brands')
        return queryset
    
    @extend_schema(
        tags=['Companies'],
        summary='Get company brands',
        description='Retrieve all brands belonging to this company.',
    )
    @action(detail=True, methods=['get'])
    def brands(self, request, pk=None):
        """
        Get all brands for a specific company.
        GET /api/v1/company/{id}/brands/
        """
        company = self.get_object()
        from apps.brands.serializers import BrandListSerializer
        brands = company.brands.all()
        serializer = BrandListSerializer(brands, many=True)
        return Response(serializer.data)
    
    @extend_schema(
        tags=['Companies'],
        summary='Get active companies',
        description='Retrieve only active companies (is_active=True).',
    )
    @action(detail=False, methods=['get'])
    def active(self, request):
        """
        Get only active companies.
        GET /api/v1/company/active/
        """
        active_companies = self.get_queryset().filter(is_active=True)
        page = self.paginate_queryset(active_companies)
        if page is not None:
            serializer = CompanyListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = CompanyListSerializer(active_companies, many=True)
        return Response(serializer.data)

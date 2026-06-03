"""
LkSystem Company App - Views
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, BasePermission
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


class _IsPlatformAdmin(BasePermission):
    """
    Permission gate for tenant-wide operations.

    True for Django superusers and for users who hold a platform-scoped
    RBAC role (typically "Super Admin"). A CEO is company-scoped and is
    deliberately excluded — they can manage their own company's data but
    not create or destroy other tenants.
    """
    message = 'This action requires platform-admin privileges.'

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return user.user_roles.filter(role__scope_type='platform').exists()


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
        """
        Optimise + scope per role.

        - Superuser / platform admin → every company (the only role allowed
          to *create* new tenants and switch between them).
        - Anyone else (CEO, Manager, …) → only their ``current_company``.

        This lets us drop the SuperAdmin-only frontend guard and rely on
        the backend to do the right thing — a CEO that hits ``/companies``
        sees exactly their own tenant.
        """
        queryset = super().get_queryset()
        if self.action == 'retrieve':
            queryset = queryset.prefetch_related('brands', 'brands__sales_channels')
        elif self.action == 'list':
            queryset = queryset.prefetch_related('brands')

        user = self.request.user
        if not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset
        # Platform-scoped role (e.g. Super Admin via RBAC) = no tenant lock.
        if user.user_roles.filter(role__scope_type='platform').exists():
            return queryset
        current_company_id = getattr(user, 'current_company_id', None)
        if not current_company_id:
            return queryset.none()
        return queryset.filter(pk=current_company_id)

    def _is_platform_admin(self, user) -> bool:
        """True when this user may operate across companies."""
        if not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return user.user_roles.filter(role__scope_type='platform').exists()

    def get_permissions(self):
        """
        Create / destroy a company are platform-admin-only — a CEO running
        the system should never be able to spin up or delete other tenants.
        Read + update of their own company is allowed (the queryset above
        already restricts the rows they can touch).
        """
        from apps.rbac.permissions import require_permission
        if self.action in ('create', 'destroy'):
            return [IsAuthenticated(), _IsPlatformAdmin()]
        if self.action in ('update', 'partial_update'):
            # Editing a company requires edit_company; the queryset still
            # restricts which company rows the user can touch.
            return [IsAuthenticated(), require_permission('edit_company')()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        """
        Create the company, then provision its own editable copies of the
        business roles (CEO, Manager, Brand Manager, Employee, Cashier).

        Per-company roles guarantee tenant isolation: editing "Brand Manager"
        for this company never touches the same-named role in another company.
        """
        company = serializer.save()
        from apps.rbac.provisioning import provision_company_roles
        provision_company_roles(company, created_by=self.request.user)
    
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

"""
LkSystem Brands App - Views
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view

from .models import Brand
from .filters import BrandFilterSet
from .serializers import BrandSerializer, BrandListSerializer
from apps.rbac.permissions import ActionPermissionMixin


@extend_schema_view(
    list=extend_schema(
        tags=['Brands'],
        summary='List all brands',
        description='Returns a paginated list of all brands. Supports filtering by company and searching by name.',
    ),
    create=extend_schema(
        tags=['Brands'],
        summary='Create a brand',
        description='Create a new brand under a company.',
    ),
    retrieve=extend_schema(
        tags=['Brands'],
        summary='Get brand details',
        description='Retrieve detailed information about a specific brand including its sales channels.',
    ),
    update=extend_schema(
        tags=['Brands'],
        summary='Update a brand',
        description='Update all fields of an existing brand.',
    ),
    partial_update=extend_schema(
        tags=['Brands'],
        summary='Partial update a brand',
        description='Update specific fields of an existing brand.',
    ),
    destroy=extend_schema(
        tags=['Brands'],
        summary='Delete a brand',
        description='Delete a brand. This will also cascade delete all related sales channels.',
    ),
)
class BrandViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
    API ViewSet for Brand management.

    Provides CRUD operations for brands.
    Supports filtering by company.
    """

    # RBAC: brand WRITES require brand permissions (unlisted writes default to
    # edit_brands). Reads stay open (IsAuthenticated) and are brand-scoped in
    # get_queryset, so brand-scoped users (e.g. Brand Manager, who has no
    # view_brands) can still read their brands for dropdowns.
    action_permissions = {
        'create': 'create_brands',
        'destroy': 'delete_brands',
    }
    default_write_permission = 'edit_brands'

    queryset = Brand.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = BrandFilterSet
    search_fields = ['name', 'company__name', 'company__abbreviation']
    ordering_fields = ['name', 'created_at', 'company__name']
    ordering = ['name']
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list':
            return BrandListSerializer
        return BrandSerializer
    
    def get_queryset(self):
        """
        Scope brands per role.

        * Superuser or platform-scoped RBAC role → every brand.
        * Company-scoped role (CEO, Manager) → every brand in the user's
          ``current_company`` (plus any explicit ``allowed_brands``). This is
          what makes the CEO role work without a per-brand row.
        * Brand/channel-scoped role (Brand Manager, Cashier) → ONLY their
          explicit ``allowed_brands``. They must never see sibling brands of
          the company, otherwise a brand manager could list or pick another
          brand's data. Scope is driven by the role's ``scope_type`` — never a
          hard-coded role name.
        * Falls back to empty when a non-company-scoped user has no
          ``allowed_brands`` (fail closed).
        """
        from django.db.models import Q

        user = self.request.user
        queryset = super().get_queryset().select_related('company')
        if self.action in ['retrieve', 'list']:
            queryset = queryset.prefetch_related('sales_channels')

        if not user.is_authenticated:
            return queryset.none()

        # Platform admin: scoped to the selected company in workspace context,
        # otherwise every brand (global mode). A brand focus narrows further.
        if user.is_superuser or user.user_roles.filter(
            role__scope_type='platform'
        ).exists():
            if getattr(user, 'current_brand_id', None):
                return queryset.filter(pk=user.current_brand_id)
            if getattr(user, 'current_company_id', None):
                return queryset.filter(company_id=user.current_company_id)
            return queryset

        # Only company-scoped (or higher) roles get the company-wide widening.
        # Brand/channel-scoped roles stay confined to their allowed_brands so
        # they can't see sibling brands of the company.
        is_company_scoped = user.user_roles.filter(
            role__scope_type='company'
        ).exists()

        scope_q = Q()
        has_any_scope = False
        if user.allowed_brands.exists():
            scope_q |= Q(pk__in=user.allowed_brands.values_list('id', flat=True))
            has_any_scope = True
        current_company_id = getattr(user, 'current_company_id', None)
        if is_company_scoped and current_company_id:
            scope_q |= Q(company_id=current_company_id)
            has_any_scope = True
        if not has_any_scope:
            return queryset.none()
        return queryset.filter(scope_q).distinct()
    
    @extend_schema(
        tags=['Brands'],
        summary='Get brand channels',
        description='Retrieve all sales channels belonging to this brand.',
    )
    @action(detail=True, methods=['get'])
    def channels(self, request, pk=None):
        """
        Get all sales channels for a specific brand.
        GET /api/v1/brands/{id}/channels/
        """
        brand = self.get_object()
        from apps.sales_channels.serializers import SalesChannelSerializer
        channels = brand.sales_channels.all()
        serializer = SalesChannelSerializer(channels, many=True)
        return Response(serializer.data)

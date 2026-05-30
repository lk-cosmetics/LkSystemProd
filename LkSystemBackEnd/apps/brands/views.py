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
class BrandViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for Brand management.
    
    Provides CRUD operations for brands.
    Supports filtering by company.
    """
    
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
        * Anyone else → the union of:
            - explicit ``allowed_brands`` (legacy per-user override that
              an admin may have set up), AND
            - every brand belonging to the user's ``current_company`` —
              this is what makes the CEO role work without an explicit
              ``allowed_brands`` row per brand.
        * Falls back to empty when the user has neither a current_company
          nor any ``allowed_brands``.
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

        scope_q = Q()
        has_any_scope = False
        if user.allowed_brands.exists():
            scope_q |= Q(pk__in=user.allowed_brands.values_list('id', flat=True))
            has_any_scope = True
        current_company_id = getattr(user, 'current_company_id', None)
        if current_company_id:
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

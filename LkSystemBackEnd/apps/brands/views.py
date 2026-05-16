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
        Filter brands based on user's role and allowed brands.
        - SuperAdmin/CEO: Sees all brands
        - Manager/other users: Only sees their assigned brands
        """
        user = self.request.user
        queryset = super().get_queryset().select_related('company')
        if self.action in ['retrieve', 'list']:
            queryset = queryset.prefetch_related('sales_channels')
        
        # SuperAdmin sees all
        if user.is_superuser:
            return queryset
        
        # Filter by user's allowed brands
        if user.allowed_brands.exists():
            return queryset.filter(pk__in=user.allowed_brands.all())
        
        # No brands assigned - return empty
        return queryset.none()
    
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

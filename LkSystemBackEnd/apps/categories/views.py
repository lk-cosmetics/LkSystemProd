"""
LkSystem Categories App - Views
DRF ViewSets for Category management and WooCommerce sync.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from .models import Category
from .serializers import (
    CategorySerializer,
    CategoryListSerializer,
    CategoryTreeSerializer,
)
from .service import CategoryService
from apps.sales_channels.models import SalesChannel


class CategoryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Category CRUD operations.
    
    Endpoints:
    - GET /categories/ - List all categories
    - POST /categories/ - Create a category
    - GET /categories/{id}/ - Retrieve a category
    - PUT /categories/{id}/ - Update a category
    - PATCH /categories/{id}/ - Partial update
    - DELETE /categories/{id}/ - Delete a category
    - GET /categories/tree/ - Get hierarchical category tree
    """
    
    queryset = Category.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['sales_channel', 'parent', 'wc_category_id']
    search_fields = ['name', 'slug', 'description']
    ordering_fields = ['name', 'display_order', 'created_at']
    ordering = ['display_order', 'name']
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list':
            return CategoryListSerializer
        if self.action == 'tree':
            return CategoryTreeSerializer
        return CategorySerializer
    
    def get_queryset(self):
        """
        Filter categories based on user's allowed brands.
        """
        user = self.request.user
        queryset = Category.objects.select_related(
            'sales_channel',
            'sales_channel__brand',
            'parent',
        ).prefetch_related('children')
        
        # Superadmin sees all
        if user.is_superuser:
            return queryset
        
        # Filter by user's allowed brands
        if user.allowed_brands.exists():
            return queryset.filter(
                sales_channel__brand__in=user.allowed_brands.all()
            )
        
        return queryset.none()
    
    def perform_create(self, serializer):
        """Set created_by on category creation."""
        serializer.save(created_by=self.request.user)
    
    def perform_update(self, serializer):
        """Set updated_by on category update."""
        serializer.save(updated_by=self.request.user)
    
    @action(detail=False, methods=['get'])
    def tree(self, request):
        """
        Get hierarchical category tree.
        Returns only root categories with nested children.
        """
        queryset = self.get_queryset().filter(parent__isnull=True)
        serializer = CategoryTreeSerializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_sales_channel(self, request):
        """
        Get categories grouped by sales channel.
        Query param: sales_channel_id (required)
        """
        sales_channel_id = request.query_params.get('sales_channel_id')
        if not sales_channel_id:
            return Response(
                {'detail': 'sales_channel_id query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        queryset = self.get_queryset().filter(sales_channel_id=sales_channel_id)
        serializer = CategoryListSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def sync(self, request):
        """
        Sync categories from WooCommerce.
        Request body: {"sales_channel": <id>}
        """
        sales_channel_id = request.data.get('sales_channel')
        
        if not sales_channel_id:
            return Response(
                {'detail': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            sales_channel = SalesChannel.objects.get(id=sales_channel_id)
        except SalesChannel.DoesNotExist:
            return Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check if user has access to this sales channel
        user = request.user
        if not user.is_superuser:
            if user.allowed_brands.exists():
                if sales_channel.brand not in user.allowed_brands.all():
                    return Response(
                        {'detail': 'You do not have access to this sales channel.'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            else:
                return Response(
                    {'detail': 'You do not have access to any sales channels.'},
                    status=status.HTTP_403_FORBIDDEN
                )
        
        # Check if sales channel is WooCommerce type
        if sales_channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return Response(
                {'detail': 'This sales channel is not a WooCommerce channel.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            service = CategoryService(sales_channel)
            result = service.sync_all(
                created_by=request.user,
                updated_by=request.user
            )
            
            return Response({
                'detail': 'Categories synced successfully.',
                'created': result.get('created', 0),
                'updated': result.get('updated', 0),
                'errors': result.get('errors', 0),
                'parents_resolved': result.get('parents_resolved', 0),
            })
        except Exception as e:
            return Response(
                {'detail': f'Sync failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    def preview(self, request):
        """
        Preview/fetch categories from WooCommerce without saving.
        Returns a list of categories from WooCommerce for selection.
        Request body: {"sales_channel": <id>}
        """
        sales_channel_id = request.data.get('sales_channel')
        
        if not sales_channel_id:
            return Response(
                {'detail': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            sales_channel = SalesChannel.objects.get(id=sales_channel_id)
        except SalesChannel.DoesNotExist:
            return Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check user access
        user = request.user
        if not user.is_superuser:
            if user.allowed_brands.exists():
                if sales_channel.brand not in user.allowed_brands.all():
                    return Response(
                        {'detail': 'You do not have access to this sales channel.'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            else:
                return Response(
                    {'detail': 'You do not have access to any sales channels.'},
                    status=status.HTTP_403_FORBIDDEN
                )
        
        if sales_channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return Response(
                {'detail': 'This sales channel is not a WooCommerce channel.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            service = CategoryService(sales_channel)
            wc_categories = service.fetch_all()
            
            # Get existing WC category IDs in local database
            existing_wc_ids = set(
                Category.objects.filter(
                    sales_channel=sales_channel
                ).values_list('wc_category_id', flat=True)
            )
            
            # Format response with sync status
            categories_preview = []
            for category in wc_categories:
                wc_id = category.get('id')
                image = category.get('image', {}) or {}
                categories_preview.append({
                    'wc_id': wc_id,
                    'name': category.get('name', ''),
                    'slug': category.get('slug', ''),
                    'description': category.get('description', ''),
                    'parent_id': category.get('parent', 0),
                    'count': category.get('count', 0),
                    'image': image.get('src', '') if image else '',
                    'exists_locally': wc_id in existing_wc_ids,
                })
            
            return Response({
                'sales_channel': sales_channel_id,
                'sales_channel_name': sales_channel.name,
                'total_count': len(categories_preview),
                'existing_count': len([c for c in categories_preview if c['exists_locally']]),
                'new_count': len([c for c in categories_preview if not c['exists_locally']]),
                'categories': categories_preview,
            })
        except Exception as e:
            return Response(
                {'detail': f'Failed to fetch categories from WooCommerce: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'], url_path='sync-selected')
    def sync_selected(self, request):
        """
        Sync selected categories from WooCommerce.
        Request body: {"sales_channel": <id>, "wc_category_ids": [1, 2, 3]}
        """
        sales_channel_id = request.data.get('sales_channel')
        wc_category_ids = request.data.get('wc_category_ids', [])
        
        if not sales_channel_id:
            return Response(
                {'detail': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not wc_category_ids or not isinstance(wc_category_ids, list):
            return Response(
                {'detail': 'wc_category_ids must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            sales_channel = SalesChannel.objects.get(id=sales_channel_id)
        except SalesChannel.DoesNotExist:
            return Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check user access
        user = request.user
        if not user.is_superuser:
            if user.allowed_brands.exists():
                if sales_channel.brand not in user.allowed_brands.all():
                    return Response(
                        {'detail': 'You do not have access to this sales channel.'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            else:
                return Response(
                    {'detail': 'You do not have access to any sales channels.'},
                    status=status.HTTP_403_FORBIDDEN
                )
        
        if sales_channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return Response(
                {'detail': 'This sales channel is not a WooCommerce channel.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            service = CategoryService(sales_channel)
            created_count = 0
            updated_count = 0
            errors = []
            
            for wc_id in wc_category_ids:
                try:
                    instance, created = service.sync_one(wc_id)
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                except Exception as e:
                    errors.append({'wc_id': wc_id, 'error': str(e)})
            
            # Resolve parent relationships after syncing
            service._resolve_parent_relationships()
            
            return Response({
                'detail': 'Selected categories synced.',
                'created': created_count,
                'updated': updated_count,
                'errors': len(errors),
                'error_details': errors if errors else None,
            })
        except Exception as e:
            return Response(
                {'detail': f'Sync failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

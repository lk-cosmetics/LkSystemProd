"""
LkSystem Promotions App - Views
ViewSet and API endpoints for Promotion management.

Hierarchy:  Company → Brand → Product → Promotion
- Admin/superuser : sees ALL promotions across all companies
- CEO             : sees all promotions (same as admin)
- Manager/others  : scoped to their allowed brands (→ company)
"""

import django_filters
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Q, Count, Sum
from django.utils import timezone
from decimal import Decimal

from .models import Promotion, PromotionChannelRule, PromotionStatus
from apps.sales_channels.models import SalesChannel
from .serializers import (
    PromotionListSerializer,
    PromotionDetailSerializer,
    PromotionCreateSerializer,
    PromotionUpdateSerializer,
    PromotionChannelRuleSerializer,
    PromotionChannelRuleInputSerializer,
    CalculateDiscountSerializer,
    DiscountResultSerializer,
    BulkCreatePromotionsSerializer,
    BulkDeletePromotionsSerializer,
    PromotionGroupListSerializer,
    PromotionGroupDetailSerializer,
    UpdatePromotionGroupSerializer,
)
from .permissions import CanManagePromotions, CanViewPromotionAnalytics


# =============================================================================
# FILTER SETS
# =============================================================================

class PromotionFilter(django_filters.FilterSet):
    """
    FilterSet for Promotion with full Company → Brand → Product → Promotion
    hierarchy traversal.

    Supports:
      ?company=<id>          filters via brand__company (traversal, not direct field)
      ?brand=<id>            direct FK
      ?product=<id>          direct FK
      ?status=active         direct field
      ?is_active=true        direct field
      ?discount_type=...     direct field
    """

    company = django_filters.NumberFilter(
        field_name='brand__company',
        lookup_expr='exact',
        label='Company ID',
    )
    sales_channel = django_filters.NumberFilter(
        field_name='channel_rules__sales_channel',
        lookup_expr='exact',
        label='Sales Channel ID',
    )
    current_only = django_filters.BooleanFilter(
        method='filter_current_only',
        label='Currently within date range',
    )
    group_id = django_filters.UUIDFilter(
        field_name='group_id',
        lookup_expr='exact',
        label='Promotion group ID',
    )

    def filter_current_only(self, queryset, name, value):
        if not value:
            return queryset
        now = timezone.now()
        return queryset.filter(start_date__lte=now).filter(
            Q(end_date__isnull=True) | Q(end_date__gte=now),
        )

    class Meta:
        model = Promotion
        fields = ['status', 'is_active', 'discount_type', 'product', 'brand']


class PromotionChannelRuleFilter(django_filters.FilterSet):
    """FilterSet for PromotionChannelRule."""

    class Meta:
        model = PromotionChannelRule
        fields = ['promotion', 'sales_channel', 'is_enabled']


# =============================================================================
# VIEWSETS
# =============================================================================

class PromotionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing Promotions.

    Provides CRUD operations plus custom actions for:
    - Channel rule management
    - Discount calculation
    - Analytics
    - Bulk operations
    """

    queryset = Promotion.objects.select_related(
        'product',
        'brand',
        'brand__company',   # pre-fetch company so get_company_name has 0 extra queries
        'created_by',
        'updated_by',
    ).prefetch_related(
        'channel_rules__sales_channel',
    ).all()

    permission_classes = [IsAuthenticated, CanManagePromotions]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = PromotionFilter          # ← proper class, NOT filterset_fields
    search_fields = ['name', 'code', 'description', 'product__name', 'brand__name']
    ordering_fields = ['created_at', 'start_date', 'end_date', 'priority', 'name']
    ordering = ['-created_at']

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == 'list':
            return PromotionListSerializer
        elif self.action == 'create':
            return PromotionCreateSerializer
        elif self.action in ('update', 'partial_update'):
            return PromotionUpdateSerializer
        return PromotionDetailSerializer

    def get_queryset(self):
        """
        Filter queryset based on user role and company hierarchy.

        Company → Brand → Product → Promotion
        ─────────────────────────────────────
        superuser / staff  → ALL promotions
        CEO role           → ALL promotions
        others             → only brands they are allowed to access
        """
        queryset = super().get_queryset()
        user = self.request.user

        if not user.is_authenticated:
            return queryset.none()

        # Admin / staff: full access
        if user.is_superuser or user.is_staff:
            return queryset

        role = getattr(user, 'role', None)

        # CEO: full access
        if role and (role.name.upper() == 'SUPERADMIN' or getattr(role, 'is_ceo', False)):
            return queryset

        try:
            from apps.rbac.services import PermissionService
            scoped_brand_ids = set(
                PermissionService.get_user_assignments(user)
                .filter(sales_channel__isnull=False)
                .values_list('sales_channel__brand_id', flat=True)
            )
            if scoped_brand_ids:
                return queryset.filter(
                    Q(brand_id__in=scoped_brand_ids) | Q(brand__isnull=True)
                )
        except Exception:
            pass

        # Everyone else: scope to their allowed brands
        # brand__company traversal gives correct company isolation
        allowed_brands = user.allowed_brands.all()
        if allowed_brands.exists():
            queryset = queryset.filter(
                Q(brand__in=allowed_brands) | Q(brand__isnull=True)
            )
        else:
            # No brands assigned → no promotions visible
            return queryset.none()

        return queryset

    # ──────────────────────────────────────────────────────────────────────────
    # Channel Rule Actions
    # ──────────────────────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='channel_rules')
    def channel_rules(self, request, pk=None):
        """GET /promotions/{id}/channel_rules/ – list all channel rules."""
        promotion = self.get_object()
        rules = promotion.channel_rules.select_related('sales_channel').all()
        serializer = PromotionChannelRuleSerializer(rules, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add_channel_rule')
    def add_channel_rule(self, request, pk=None):
        """POST /promotions/{id}/add_channel_rule/ – add a channel rule."""
        promotion = self.get_object()
        serializer = PromotionChannelRuleInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        sales_channel = data['sales_channel']

        if promotion.channel_rules.filter(sales_channel=sales_channel).exists():
            return Response(
                {'error': 'Rule for this channel already exists.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rule = PromotionChannelRule.objects.create(
            promotion=promotion,
            sales_channel=sales_channel,
            discount_value=data['discount_value'],
            is_enabled=data.get('is_enabled', True),
            channel_priority=data.get('channel_priority', 0),
            channel_max_usage=data.get('channel_max_usage'),
        )

        return Response(
            PromotionChannelRuleSerializer(rule).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['put', 'patch'], url_path='update_channel_rule')
    def update_channel_rule(self, request, pk=None):
        """PUT/PATCH /promotions/{id}/update_channel_rule/ – update a channel rule."""
        promotion = self.get_object()
        sales_channel_id = request.data.get('sales_channel')

        if not sales_channel_id:
            return Response(
                {'error': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            rule = promotion.channel_rules.get(sales_channel_id=sales_channel_id)
        except PromotionChannelRule.DoesNotExist:
            return Response(
                {'error': 'Channel rule not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        
        if rule.sales_channel.channel_type != SalesChannel.ChannelType.POS:
            return Response(
                {'error': 'Promotions can only be applied to POS sales channels.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for field in ('discount_value', 'is_enabled', 'channel_priority', 'channel_max_usage'):
            if field in request.data:
                setattr(rule, field, request.data[field])

        rule.save()
        return Response(PromotionChannelRuleSerializer(rule).data)

    @action(detail=True, methods=['delete'], url_path='remove_channel_rule')
    def remove_channel_rule(self, request, pk=None):
        """DELETE /promotions/{id}/remove_channel_rule/?sales_channel=X"""
        promotion = self.get_object()
        sales_channel_id = request.query_params.get('sales_channel')

        if not sales_channel_id:
            return Response(
                {'error': 'sales_channel query param is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted, _ = promotion.channel_rules.filter(
            sales_channel_id=sales_channel_id
        ).delete()

        if deleted == 0:
            return Response(
                {'error': 'Channel rule not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(status=status.HTTP_204_NO_CONTENT)

    # ──────────────────────────────────────────────────────────────────────────
    # Discount Calculation
    # ──────────────────────────────────────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='calculate_discount')
    def calculate_discount(self, request):
        """POST /promotions/calculate_discount/ – calculate discount for product/channel."""
        serializer = CalculateDiscountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        product_id = data['product_id']
        sales_channel_id = data['sales_channel_id']

        from apps.products.models import Product

        try:
            product = Product.objects.get(id=product_id)
            channel = SalesChannel.objects.get(id=sales_channel_id)
        except (Product.DoesNotExist, SalesChannel.DoesNotExist):
            return Response(
                {'error': 'Product or Sales Channel not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if channel.channel_type != SalesChannel.ChannelType.POS:
            return Response(
                {'error': 'Promotions are only available for POS sales channels.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        # Only find promotions that have an ENABLED rule for this specific channel.
        # Without this filter the old code fell back to default_discount_value (often 0)
        # and returned "no discount" even though a channel rule existed.
        promotions = Promotion.objects.filter(
            Q(end_date__isnull=True) | Q(end_date__gte=now),
            product_id=product_id,
            status=PromotionStatus.ACTIVE,
            is_active=True,
            start_date__lte=now,
            channel_rules__sales_channel_id=sales_channel_id,
            channel_rules__is_enabled=True,
        ).select_related('product').prefetch_related(
            'channel_rules'
        ).order_by('-priority').distinct()

        if not promotions.exists():
            return Response(
                {'message': 'No active promotions found for this product on this channel.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        original_price = data.get('original_price') or product.sales_price or Decimal('0')

        for promotion in promotions:
            if not promotion.is_within_usage_limit:
                continue
            discounted_price = promotion.calculate_discounted_price(
                original_price, channel.id
            )
            if discounted_price is not None:
                discount_value = promotion.get_discount_for_channel(channel.id)
                savings = original_price - discounted_price
                return Response({
                    'product_id': product.id,
                    'product_name': product.name,
                    'sales_channel_id': channel.id,
                    'sales_channel_name': channel.name,
                    'original_price': str(original_price),
                    'discount_value': str(discount_value),
                    'discount_type': promotion.get_discount_type_display(),
                    'discounted_price': str(discounted_price),
                    'savings': str(savings),
                    'promotion_id': promotion.id,
                    'promotion_name': promotion.name,
                })

        return Response(
            {'message': 'No applicable promotions for this channel.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    @action(detail=False, methods=['post'], url_path='batch_calculate_discounts')
    def batch_calculate_discounts(self, request):
        """
        POST /promotions/batch_calculate_discounts/

        Body: { product_ids: [1, 2, 3], sales_channel_id: 5 }

        Returns a dict of product_id → discount result for every product that has
        an active, enabled promotion on this channel.  Products with no promotion
        are simply omitted from the response (frontend falls back to sales_price).

        Using a single query instead of N individual calls avoids both the N+1
        problem and async race-conditions on the POS page.
        """
        product_ids = request.data.get('product_ids', [])
        sales_channel_id = request.data.get('sales_channel_id')

        if not product_ids or not sales_channel_id:
            return Response(
                {'error': 'product_ids and sales_channel_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            channel = SalesChannel.objects.get(id=sales_channel_id)
        except SalesChannel.DoesNotExist:
            return Response(
                {'error': 'Sales Channel not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if channel.channel_type != SalesChannel.ChannelType.POS:
            return Response(
                {'error': 'Promotions are only available for POS sales channels.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        # ``end_date`` is nullable for open-ended campaigns (run until manually
        # deactivated). The old strict ``end_date__gte=now`` silently excluded
        # every such promotion → POS product cards lost their badges after the
        # campaign refactor. The Q(...) clause restores parity.
        promotions = Promotion.objects.filter(
            Q(end_date__isnull=True) | Q(end_date__gte=now),
            product_id__in=product_ids,
            status=PromotionStatus.ACTIVE,
            is_active=True,
            start_date__lte=now,
            channel_rules__sales_channel_id=sales_channel_id,
            channel_rules__is_enabled=True,
        ).select_related('product').prefetch_related(
            'channel_rules'
        ).order_by('product_id', '-priority').distinct()

        results = {}
        for promotion in promotions:
            pid = promotion.product_id
            # Keep only the highest-priority promotion per product
            if pid in results:
                continue
            if not promotion.is_within_usage_limit:
                continue

            product = promotion.product
            original_price = product.sales_price or Decimal('0')
            discounted_price = promotion.calculate_discounted_price(original_price, channel.id)

            if discounted_price is None:
                continue

            discount_value = promotion.get_discount_for_channel(channel.id)
            savings = original_price - discounted_price

            results[str(pid)] = {
                'product_id': pid,
                'product_name': product.name,
                'sales_channel_id': channel.id,
                'sales_channel_name': channel.name,
                'original_price': str(original_price),
                'discounted_price': str(discounted_price),
                'savings': str(savings),
                'discount_value': str(discount_value),
                'discount_type': promotion.get_discount_type_display(),
                'promotion_id': promotion.id,
                'promotion_name': promotion.name,
            }

        return Response({
            'sales_channel_id': channel.id,
            'results': results,
        })

    # ──────────────────────────────────────────────────────────────────────────
    # Analytics
    # ──────────────────────────────────────────────────────────────────────────

    @action(
        detail=False,
        methods=['get'],
        url_path='analytics',
        permission_classes=[IsAuthenticated, CanViewPromotionAnalytics],
    )
    def analytics(self, request):
        """GET /promotions/analytics/ – promotion usage statistics."""
        queryset = self.get_queryset()
        now = timezone.now()

        stats = {
            'total_promotions': queryset.count(),
            'active_promotions': queryset.filter(
                Q(end_date__isnull=True) | Q(end_date__gte=now),
                status=PromotionStatus.ACTIVE,
                is_active=True,
                start_date__lte=now,
            ).count(),
            'draft_promotions': queryset.filter(status=PromotionStatus.DRAFT).count(),
            'expired_promotions': queryset.filter(end_date__lt=now).count(),
            'scheduled_promotions': queryset.filter(
                status=PromotionStatus.ACTIVE,
                start_date__gt=now,
            ).count(),
            'total_usage': queryset.aggregate(
                total=Sum('current_usage')
            )['total'] or 0,
            'by_discount_type': list(
                queryset.values('discount_type').annotate(
                    count=Count('id')
                ).order_by('discount_type')
            ),
            'by_status': list(
                queryset.values('status').annotate(
                    count=Count('id')
                ).order_by('status')
            ),
        }

        return Response(stats)

    # ──────────────────────────────────────────────────────────────────────────
    # Status Management
    # ──────────────────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='activate')
    def activate(self, request, pk=None):
        """POST /promotions/{id}/activate/"""
        promotion = self.get_object()
        promotion.status = PromotionStatus.ACTIVE
        promotion.is_active = True
        promotion.updated_by = request.user
        promotion.save(update_fields=['status', 'is_active', 'updated_by', 'updated_at'])
        return Response({'status': 'Promotion activated.'})

    @action(detail=True, methods=['post'], url_path='deactivate')
    def deactivate(self, request, pk=None):
        """POST /promotions/{id}/deactivate/"""
        promotion = self.get_object()
        promotion.is_active = False
        promotion.updated_by = request.user
        promotion.save(update_fields=['is_active', 'updated_by', 'updated_at'])
        return Response({'status': 'Promotion deactivated.'})

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """POST /promotions/{id}/duplicate/ – create a copy."""
        original = self.get_object()

        new_promotion = Promotion.objects.create(
            name=f"{original.name} (Copy)",
            description=original.description,
            code=f"{original.code}_COPY" if original.code else '',
            product=original.product,
            brand=original.brand,
            discount_type=original.discount_type,
            default_discount_value=original.default_discount_value,
            start_date=original.start_date,
            end_date=original.end_date,
            status=PromotionStatus.DRAFT,
            is_active=False,
            max_usage=original.max_usage,
            priority=original.priority,
            is_stackable=original.is_stackable,
            created_by=request.user,
            updated_by=request.user,
        )

        # Copy channel rules in bulk
        PromotionChannelRule.objects.bulk_create([
            PromotionChannelRule(
                promotion=new_promotion,
                sales_channel=rule.sales_channel,
                discount_value=rule.discount_value,
                is_enabled=rule.is_enabled,
                channel_priority=rule.channel_priority,
                channel_max_usage=rule.channel_max_usage,
            )
            for rule in original.channel_rules.all()
        ])

        serializer = PromotionDetailSerializer(new_promotion)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ──────────────────────────────────────────────────────────────────────────
    # Bulk Operations
    # ──────────────────────────────────────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='bulk_activate')
    def bulk_activate(self, request):
        """POST /promotions/bulk_activate/ – activate multiple promotions."""
        ids = request.data.get('ids', [])
        if not ids:
            return Response(
                {'error': 'ids list is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = self.get_queryset().filter(id__in=ids).update(
            status=PromotionStatus.ACTIVE,
            is_active=True,
        )
        return Response({'activated': updated})

    @action(detail=False, methods=['post'], url_path='bulk_deactivate')
    def bulk_deactivate(self, request):
        """POST /promotions/bulk_deactivate/ – deactivate multiple promotions."""
        ids = request.data.get('ids', [])
        if not ids:
            return Response(
                {'error': 'ids list is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = self.get_queryset().filter(id__in=ids).update(is_active=False)
        return Response({'deactivated': updated})

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        """POST /promotions/bulk_delete/ – delete multiple promotions atomically."""
        serializer = BulkDeletePromotionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data['ids']

        qs = self.get_queryset().filter(id__in=ids)
        # Honour object-level perms: only delete what this user is allowed to see
        deleted_count = qs.count()
        qs.delete()
        return Response({'deleted': deleted_count})

    @action(detail=False, methods=['post'], url_path='bulk_create')
    def bulk_create(self, request):
        """
        POST /promotions/bulk_create/

        Create one promotion per ``items`` entry, all sharing the same name,
        schedule, status and sales-channel set. Each item carries its own
        ``discount_type`` and ``discount_value``, which is also applied to every
        selected channel via PromotionChannelRule. All inserts happen in one
        atomic transaction.
        """
        serializer = BulkCreatePromotionsSerializer(
            data=request.data, context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        promotions = serializer.save()

        # Return a lightweight list payload — list serializer already handles N rows
        list_payload = PromotionListSerializer(promotions, many=True).data
        return Response(
            {'created': len(promotions), 'results': list_payload},
            status=status.HTTP_201_CREATED,
        )

    # =========================================================================
    # PROMOTION GROUP ENDPOINTS
    # =========================================================================

    def _group_aggregate(self, members):
        """Reduce a list of sibling promotions into one campaign payload.

        Members of a wizard-created group always share the same metadata, so
        we take it from the most-recently updated row. ``discount_min/max``
        spans the per-product discount values that differ between members.
        """
        members = list(members)
        if not members:
            return None
        head = max(members, key=lambda p: p.updated_at)
        discount_values = [p.default_discount_value for p in members]
        channel_ids = sorted({
            rule.sales_channel_id
            for p in members
            for rule in p.channel_rules.all()
        })
        # One lookup for the human-readable labels — the detail UI shows
        # "carfour" instead of "Channel #2". Falls back to a placeholder
        # if a channel was hard-deleted while still referenced by rules.
        channel_name_map = dict(
            SalesChannel.objects.filter(pk__in=channel_ids).values_list('id', 'name')
        )
        sales_channels = [
            {'id': cid, 'name': channel_name_map.get(cid, f'Channel #{cid}')}
            for cid in channel_ids
        ]
        return {
            'group_id': head.group_id,
            'name': head.name,
            'code': head.code,
            'description': head.description,
            'brand': head.brand_id,
            'brand_name': head.brand.name if head.brand_id else None,
            'company_id': head.brand.company_id if head.brand_id else None,
            'company_name': (
                head.brand.company.name
                if head.brand_id and head.brand.company_id
                else None
            ),
            'start_date': head.start_date,
            'end_date': head.end_date,
            'status': head.status,
            'is_active': head.is_active,
            'is_currently_active': any(p.is_currently_active for p in members),
            'is_stackable': head.is_stackable,
            'priority': head.priority,
            'max_usage': head.max_usage,
            'total_usage': sum(p.current_usage for p in members),
            'product_count': len(members),
            'channel_count': len(channel_ids),
            'discount_min': min(discount_values) if discount_values else None,
            'discount_max': max(discount_values) if discount_values else None,
            'discount_types': sorted({p.discount_type for p in members}),
            'created_at': min(p.created_at for p in members),
            'updated_at': max(p.updated_at for p in members),
            'members': members,
            'sales_channel_ids': channel_ids,
            'sales_channels': sales_channels,
        }

    @action(detail=False, methods=['get'], url_path='groups')
    def groups(self, request):
        """GET /promotions/groups/ – campaign list (one row per group_id)."""
        from collections import defaultdict

        qs = self.filter_queryset(self.get_queryset())
        # Only rows with a group_id (legacy rows get one via migration 0005).
        qs = qs.exclude(group_id__isnull=True)

        # Group in Python — the dataset is small enough that this is cheaper
        # than a SQL window + jsonb_agg dance and keeps prefetch_related
        # working for the channel-count aggregate.
        buckets = defaultdict(list)
        for promo in qs:
            buckets[promo.group_id].append(promo)

        aggregated = [self._group_aggregate(rows) for rows in buckets.values()]
        # Newest campaign first.
        aggregated.sort(key=lambda g: g['updated_at'], reverse=True)

        page = self.paginate_queryset(aggregated)
        serializer = PromotionGroupListSerializer(page or aggregated, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=False, methods=['get', 'delete'],
            url_path=r'groups/(?P<group_id>[0-9a-fA-F-]{36})')
    def group_detail(self, request, group_id=None):
        """GET / DELETE /promotions/groups/<group_id>/ – full group payload, or atomic delete."""
        qs = self.get_queryset().filter(group_id=group_id)
        if request.method == 'DELETE':
            count = qs.count()
            if not count:
                return Response(
                    {'detail': 'Promotion group not found.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            qs.delete()
            return Response({'deleted': count}, status=status.HTTP_200_OK)
        members = list(qs)
        if not members:
            return Response(
                {'detail': 'Promotion group not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        payload = self._group_aggregate(members)
        return Response(PromotionGroupDetailSerializer(payload).data)

    @action(detail=False, methods=['post'],
            url_path=r'groups/(?P<group_id>[0-9a-fA-F-]{36})/update')
    def group_update(self, request, group_id=None):
        """POST /promotions/groups/<group_id>/update/ – atomic group edit."""
        from django.db import transaction

        members = list(self.get_queryset().filter(group_id=group_id).select_related('product'))
        if not members:
            return Response(
                {'detail': 'Promotion group not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = UpdatePromotionGroupSerializer(
            data=request.data, context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        channels = data.pop('_channels')
        items = data.pop('items')

        # Brand stays locked to the group's existing brand — users wanting a
        # different brand should create a new campaign.
        brand_id = members[0].brand_id

        shared_meta = {
            'name': data['name'],
            'description': data.get('description', ''),
            'code': data.get('code') or '',
            'start_date': data['start_date'],
            'end_date': data.get('end_date'),
            'status': data.get('status'),
            'is_active': data.get('is_active', True),
            'is_stackable': data.get('is_stackable', False),
            'priority': data.get('priority', 0),
            'max_usage': data.get('max_usage'),
        }

        user = getattr(request, 'user', None)
        members_by_id = {m.id: m for m in members}
        kept_ids: set[int] = set()

        with transaction.atomic():
            for item in items:
                product = item['product']
                discount_type = item['discount_type']
                discount_value = item['discount_value']
                member_id = item.get('member_id')

                if member_id and member_id in members_by_id:
                    promo = members_by_id[member_id]
                    for key, value in shared_meta.items():
                        setattr(promo, key, value)
                    promo.product = product
                    promo.discount_type = discount_type
                    promo.default_discount_value = discount_value
                    if user and user.is_authenticated:
                        promo.updated_by = user
                    promo.save()
                    kept_ids.add(promo.id)
                else:
                    promo = Promotion.objects.create(
                        group_id=group_id,
                        brand_id=brand_id,
                        product=product,
                        discount_type=discount_type,
                        default_discount_value=discount_value,
                        created_by=user if user and user.is_authenticated else None,
                        updated_by=user if user and user.is_authenticated else None,
                        **shared_meta,
                    )
                    kept_ids.add(promo.id)

                # Reset channel rules — same set, mirrored per-product discount.
                promo.channel_rules.all().delete()
                PromotionChannelRule.objects.bulk_create([
                    PromotionChannelRule(
                        promotion=promo,
                        sales_channel=ch,
                        discount_value=discount_value,
                        is_enabled=True,
                    )
                    for ch in channels
                ])

            # Any pre-existing member not represented in the new items is removed.
            removed = [m.id for m in members if m.id not in kept_ids]
            if removed:
                Promotion.objects.filter(id__in=removed).delete()

        refreshed = list(self.get_queryset().filter(group_id=group_id))
        payload = self._group_aggregate(refreshed)
        return Response(PromotionGroupDetailSerializer(payload).data)

# =============================================================================
# PROMOTION CHANNEL RULE VIEWSET
# =============================================================================

class PromotionChannelRuleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for direct management of PromotionChannelRules.
    """

    queryset = PromotionChannelRule.objects.select_related(
        'promotion',
        'promotion__brand',
        'promotion__brand__company',
        'sales_channel',
    ).all()

    serializer_class = PromotionChannelRuleSerializer
    permission_classes = [IsAuthenticated, CanManagePromotions]
    filter_backends = [DjangoFilterBackend]
    filterset_class = PromotionChannelRuleFilter

    def get_queryset(self):
        """Filter by user permissions via promotion → brand → company chain."""
        queryset = super().get_queryset()
        user = self.request.user

        if not user.is_authenticated:
            return queryset.none()

        if user.is_superuser or user.is_staff:
            return queryset

        role = getattr(user, 'role', None)
        if role and (role.name.upper() == 'SUPERADMIN' or getattr(role, 'is_ceo', False)):
            return queryset

        allowed_brands = user.allowed_brands.all()
        if allowed_brands.exists():
            queryset = queryset.filter(
                Q(promotion__brand__in=allowed_brands) |
                Q(promotion__brand__isnull=True)
            )
        else:
            return queryset.none()

        return queryset

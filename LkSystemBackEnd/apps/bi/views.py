"""
BI dashboard API views.

All endpoints are read-only and gated by ``IsBIUser`` (only Super Admin and
CEO roles have ``view_bi_dashboard``). Tenant scoping is enforced by
``scope_request_to_user`` — a CEO is forced to their own company.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiParameter

from apps.bi import cache as bi_cache
from apps.bi.permissions import IsBIUser, is_platform_admin, scope_request_to_user
from apps.bi.services import (
    PERIOD_CHOICES,
    bad_products,
    product_resale_types,
    sales_channel_chart,
    sales_channel_revenue,
    sales_chart,
    summary,
    top_products,
    trending_products,
)
from apps.brands.models import Brand
from apps.company.models import Company


def _query_param(request, name: str, default=None):
    value = request.query_params.get(name, default)
    if value in ('', 'null', 'undefined'):
        return default
    return value


def _normalise_period(period: str) -> str:
    period = (period or '30d').lower()
    if period not in PERIOD_CHOICES:
        return '30d'
    return period


@extend_schema(tags=['BI Dashboard'])
class CompaniesListView(APIView):
    """Companies the current BI user may pick from."""

    permission_classes = [IsAuthenticated, IsBIUser]

    def get(self, request):
        user = request.user
        if is_platform_admin(user):
            qs = Company.objects.filter(is_active=True).order_by('name')
        else:
            current_id = getattr(user, 'current_company_id', None)
            qs = Company.objects.filter(pk=current_id) if current_id else Company.objects.none()

        return Response([
            {'id': c.id, 'name': c.name, 'abbreviation': c.abbreviation}
            for c in qs
        ])


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
    ],
)
class BrandsListView(APIView):
    """Brands visible to the BI user (scoped to the requested/locked company)."""

    permission_classes = [IsAuthenticated, IsBIUser]

    def get(self, request):
        user = request.user
        requested_company = _query_param(request, 'company_id')
        company_id, _ = scope_request_to_user(user, requested_company, None)

        qs = Brand.objects.select_related('company').order_by('name')

        if is_platform_admin(user):
            if company_id:
                qs = qs.filter(company_id=company_id)
        else:
            if not company_id:
                return Response([])
            qs = qs.filter(company_id=company_id)
            allowed_ids = list(user.allowed_brands.values_list('id', flat=True)) \
                if hasattr(user, 'allowed_brands') else []
            if allowed_ids:
                qs = qs.filter(pk__in=allowed_ids)

        return Response([
            {
                'id': b.id,
                'name': b.name,
                'company_id': b.company_id,
                'company_name': b.company.name if b.company_id else None,
            }
            for b in qs
        ])


class _BaseBIView(APIView):
    permission_classes = [IsAuthenticated, IsBIUser]
    kind: str = ''

    def _resolve(self, request):
        period = _normalise_period(_query_param(request, 'period', '30d'))
        company_id, brand_id = scope_request_to_user(
            request.user,
            _query_param(request, 'company_id'),
            _query_param(request, 'brand_id'),
        )
        # Only honoured when period == 'custom'; ignored otherwise. ``YYYY-MM-DD``.
        start_date = _query_param(request, 'start_date')
        end_date = _query_param(request, 'end_date')
        return company_id, brand_id, period, start_date, end_date


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter(
            'period', str, required=False,
            description='One of: 7d, 30d, 3m, ytd',
        ),
    ],
)
class SummaryView(_BaseBIView):
    kind = 'summary'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        key = bi_cache.build_key(self.kind, company_id=company_id,
                                 brand_id=brand_id, period=period,
                                 start_date=start_date, end_date=end_date)
        data = bi_cache.get_or_set(
            key,
            lambda: summary(company_id=company_id, brand_id=brand_id, period=period,
                            start_date=start_date, end_date=end_date),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
    ],
)
class SalesChartView(_BaseBIView):
    kind = 'sales_chart'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        key = bi_cache.build_key(self.kind, company_id=company_id,
                                 brand_id=brand_id, period=period,
                                 start_date=start_date, end_date=end_date)
        data = bi_cache.get_or_set(
            key,
            lambda: sales_chart(company_id=company_id, brand_id=brand_id, period=period,
                                start_date=start_date, end_date=end_date),
        )
        return Response(data)


def _pagination_params(request, *, default_page_size=10, max_page_size=100):
    try:
        page = max(1, int(request.query_params.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.query_params.get('page_size', default_page_size))
    except (TypeError, ValueError):
        page_size = default_page_size
    page_size = max(1, min(page_size, max_page_size))
    return page, page_size


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
        OpenApiParameter('page', int, required=False),
        OpenApiParameter('page_size', int, required=False),
    ],
)
class SalesChannelRevenueView(_BaseBIView):
    """Revenue and orders per individual sales channel, paginated."""

    kind = 'sales_channels'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        page, page_size = _pagination_params(request, default_page_size=10)
        key = (
            f'{bi_cache.build_key(self.kind, company_id=company_id, brand_id=brand_id, period=period, start_date=start_date, end_date=end_date)}'
            f':page:{page}:size:{page_size}'
        )
        data = bi_cache.get_or_set(
            key,
            lambda: sales_channel_revenue(
                company_id=company_id, brand_id=brand_id, period=period,
                start_date=start_date, end_date=end_date,
                page=page, page_size=page_size,
            ),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
    ],
)
class SalesChannelChartView(_BaseBIView):
    """Daily per-channel revenue series for stacked-area / multi-line charts."""

    kind = 'sales_channel_chart'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        key = bi_cache.build_key(self.kind, company_id=company_id,
                                 brand_id=brand_id, period=period,
                                 start_date=start_date, end_date=end_date)
        data = bi_cache.get_or_set(
            key,
            lambda: sales_channel_chart(
                company_id=company_id, brand_id=brand_id, period=period,
                start_date=start_date, end_date=end_date,
            ),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
        OpenApiParameter('page', int, required=False),
        OpenApiParameter('page_size', int, required=False),
    ],
)
class TopProductsView(_BaseBIView):
    kind = 'top_products'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        page, page_size = _pagination_params(request, default_page_size=10)
        key = (
            f'{bi_cache.build_key(self.kind, company_id=company_id, brand_id=brand_id, period=period, start_date=start_date, end_date=end_date)}'
            f':page:{page}:size:{page_size}'
        )
        data = bi_cache.get_or_set(
            key,
            lambda: top_products(
                company_id=company_id, brand_id=brand_id, period=period,
                start_date=start_date, end_date=end_date,
                page=page, page_size=page_size,
            ),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
        OpenApiParameter('start_date', str, required=False, description='YYYY-MM-DD (custom period only)'),
        OpenApiParameter('end_date', str, required=False, description='YYYY-MM-DD (custom period only)'),
        OpenApiParameter('page', int, required=False),
        OpenApiParameter('page_size', int, required=False),
    ],
)
class BadProductsView(_BaseBIView):
    """Worst-selling products in the period (revenue asc among products that sold)."""

    kind = 'bad_products'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        page, page_size = _pagination_params(request, default_page_size=10)
        key = (
            f'{bi_cache.build_key(self.kind, company_id=company_id, brand_id=brand_id, period=period, start_date=start_date, end_date=end_date)}'
            f':page:{page}:size:{page_size}'
        )
        data = bi_cache.get_or_set(
            key,
            lambda: bad_products(
                company_id=company_id, brand_id=brand_id, period=period,
                start_date=start_date, end_date=end_date,
                page=page, page_size=page_size,
            ),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
        OpenApiParameter('page', int, required=False),
        OpenApiParameter('page_size', int, required=False),
    ],
)
class TrendingProductsView(_BaseBIView):
    kind = 'trending_products'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        page, page_size = _pagination_params(request, default_page_size=10)
        key = (
            f'{bi_cache.build_key(self.kind, company_id=company_id, brand_id=brand_id, period=period, start_date=start_date, end_date=end_date)}'
            f':page:{page}:size:{page_size}'
        )
        data = bi_cache.get_or_set(
            key,
            lambda: trending_products(
                company_id=company_id, brand_id=brand_id, period=period,
                start_date=start_date, end_date=end_date,
                page=page, page_size=page_size,
            ),
        )
        return Response(data)


@extend_schema(
    tags=['BI Dashboard'],
    parameters=[
        OpenApiParameter('company_id', int, required=False),
        OpenApiParameter('brand_id', int, required=False),
        OpenApiParameter('period', str, required=False),
    ],
)
class ProductResaleTypesView(_BaseBIView):
    kind = 'resale_types'

    def get(self, request):
        company_id, brand_id, period, start_date, end_date = self._resolve(request)
        key = bi_cache.build_key(self.kind, company_id=company_id,
                                 brand_id=brand_id, period=period,
                                 start_date=start_date, end_date=end_date)
        data = bi_cache.get_or_set(
            key,
            lambda: product_resale_types(company_id=company_id, brand_id=brand_id, period=period,
                                         start_date=start_date, end_date=end_date),
        )
        return Response(data)

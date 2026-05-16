"""BI dashboard URL configuration."""

from django.urls import path

from apps.bi.views import (
    BadProductsView,
    BrandsListView,
    CompaniesListView,
    ProductResaleTypesView,
    SalesChannelChartView,
    SalesChannelRevenueView,
    SalesChartView,
    SummaryView,
    TopProductsView,
    TrendingProductsView,
)

app_name = 'bi'

urlpatterns = [
    path('companies/', CompaniesListView.as_view(), name='companies'),
    path('brands/', BrandsListView.as_view(), name='brands'),
    path('summary/', SummaryView.as_view(), name='summary'),
    path('sales-chart/', SalesChartView.as_view(), name='sales-chart'),
    path('sales-channel-chart/', SalesChannelChartView.as_view(), name='sales-channel-chart'),
    path('sales-channel-revenue/', SalesChannelRevenueView.as_view(), name='sales-channel-revenue'),
    path('top-products/', TopProductsView.as_view(), name='top-products'),
    path('bad-products/', BadProductsView.as_view(), name='bad-products'),
    path('trending-products/', TrendingProductsView.as_view(), name='trending-products'),
    path('product-resale-types/', ProductResaleTypesView.as_view(), name='product-resale-types'),
]

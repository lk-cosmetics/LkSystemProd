"""
LkSystem BI App — Aggregated stats models.

Two per-day rollup tables feed the executive dashboard. Raw orders remain the
source of truth; these rows are recomputed by Celery whenever an order or
order line changes.
"""

from __future__ import annotations

from django.db import models


class DailyBrandChannelStats(models.Model):
    """Per-day revenue/orders/customers for (company, brand, sales_channel)."""

    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='bi_daily_channel_stats',
    )
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.CASCADE,
        related_name='bi_daily_channel_stats',
    )
    date = models.DateField(db_index=True)
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        related_name='bi_daily_stats',
    )

    revenue = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    orders_count = models.PositiveIntegerField(default=0)
    customers_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bi_daily_brand_channel_stats'
        verbose_name = 'Daily Brand/Channel Stats'
        verbose_name_plural = 'Daily Brand/Channel Stats'
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'brand', 'date', 'sales_channel'],
                name='uniq_daily_brand_channel_stats',
            ),
        ]
        indexes = [
            models.Index(fields=['company', 'brand', 'date']),
            models.Index(fields=['company', 'brand', 'sales_channel', 'date']),
        ]
        ordering = ['-date']

    def __str__(self) -> str:
        return (
            f'{self.date} c={self.company_id} b={self.brand_id} '
            f'ch={self.sales_channel_id} rev={self.revenue}'
        )


class DailyProductResaleStats(models.Model):
    """Per-day per-resale-type rollup (resale_type = Product.product_type)."""

    RESALE_TYPE_CHOICES = (
        ('resell', 'Resell'),
        ('packaging', 'Packaging'),
        ('finished', 'Finished'),
        ('component', 'Component'),
        ('raw_material', 'Raw Material'),
    )

    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='bi_daily_resale_stats',
    )
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.CASCADE,
        related_name='bi_daily_resale_stats',
    )
    date = models.DateField(db_index=True)
    resale_type = models.CharField(max_length=32, choices=RESALE_TYPE_CHOICES)

    sales_count = models.PositiveIntegerField(default=0)
    quantity_sold = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=16, decimal_places=2, default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bi_daily_product_resale_stats'
        verbose_name = 'Daily Product Resale Stats'
        verbose_name_plural = 'Daily Product Resale Stats'
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'brand', 'date', 'resale_type'],
                name='uniq_daily_product_resale_stats',
            ),
        ]
        indexes = [
            models.Index(fields=['company', 'brand', 'date']),
            models.Index(fields=['company', 'brand', 'resale_type', 'date']),
        ]
        ordering = ['-date']

    def __str__(self) -> str:
        return (
            f'{self.date} c={self.company_id} b={self.brand_id} '
            f'rt={self.resale_type} rev={self.revenue}'
        )

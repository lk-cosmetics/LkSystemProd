"""
LkSystem Brands App - Models
Brand entity belonging to a Company.
"""

from django.db import models


class Brand(models.Model):
    """
    Brand entity belonging to a Company.
    A company can have multiple brands.
    """
    
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='brands',
        verbose_name='Company'
    )
    name = models.CharField(
        max_length=255,
        verbose_name='Brand Name'
    )
    logo = models.ImageField(
        upload_to='brands/logos/',
        null=True,
        blank=True,
        verbose_name='Brand Logo'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        app_label = 'brands'
        db_table = 'brand'
        verbose_name = 'Brand'
        verbose_name_plural = 'Brands'
        ordering = ['company', 'name']
        unique_together = ['company', 'name']
    
    def __str__(self):
        return f"{self.name} ({self.company.abbreviation})"

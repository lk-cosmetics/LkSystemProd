"""
LkSystem RBAC — Models
Dynamic, scoped, permission-based access control.
"""

from django.conf import settings
from django.db import models


class AppPermission(models.Model):
    """
    Granular business-level permission.

    Unlike Django's built-in ``auth.Permission`` (which is tied to content
    types / CRUD on models), these represent *business actions* such as
    ``use_pos``, ``manage_inventory``, or ``export_data``.
    """

    codename = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        help_text='Machine-readable identifier (e.g. manage_products)',
    )
    name = models.CharField(
        max_length=255,
        help_text='Human-readable label (e.g. Manage Products)',
    )
    category = models.CharField(
        max_length=50,
        db_index=True,
        help_text='Logical group for UI display (e.g. products, orders)',
    )
    description = models.TextField(
        blank=True,
        default='',
    )

    class Meta:
        db_table = 'rbac_permission'
        ordering = ['category', 'codename']
        verbose_name = 'Permission'
        verbose_name_plural = 'Permissions'

    def __str__(self):
        return f'{self.category}:{self.codename}'


class Role(models.Model):
    """
    Dynamic role with granular permissions.

    ``scope_type`` indicates the *level* at which this role operates:

    * **platform** — system-wide (e.g. Super Admin)
    * **company**  — applies within one company
    * **brand**    — applies within one brand
    * **channel**  — applies within one sales channel

    A role is owned by a company (``company`` FK) unless it is a
    platform-level role (``company`` is ``NULL``).
    """

    SCOPE_CHOICES = [
        ('platform', 'Platform'),
        ('company', 'Company'),
        ('brand', 'Brand'),
        ('channel', 'Sales Channel'),
    ]

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default='')
    permissions = models.ManyToManyField(
        AppPermission,
        blank=True,
        related_name='roles',
    )
    scope_type = models.CharField(
        max_length=20,
        choices=SCOPE_CHOICES,
        default='company',
    )
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='rbac_roles',
        help_text='Owner company.  NULL = platform-wide role.',
    )
    is_system = models.BooleanField(
        default=False,
        help_text='System roles cannot be deleted or renamed.',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rbac_role'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['name', 'company'],
                name='unique_role_name_per_company',
            ),
        ]
        verbose_name = 'Role'
        verbose_name_plural = 'Roles'

    def __str__(self):
        suffix = f' ({self.company.abbreviation})' if self.company else ' (Platform)'
        return f'{self.name}{suffix}'

    def get_permission_codenames(self) -> list[str]:
        return list(self.permissions.values_list('codename', flat=True))


class UserRole(models.Model):
    """
    Assigns a role to a user **at a specific scope**.

    Which FK is populated determines the scope:

    ==============================  ==================
    All NULL                        Platform-level
    ``company`` set                 Company-level
    ``brand`` set                   Brand-level
    ``sales_channel`` set           Channel-level
    ==============================  ==================

    Permissions **cascade downward**: a company-level assignment
    grants access to every brand and channel under that company.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='user_roles',
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='+',
    )
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='+',
    )
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='+',
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'rbac_user_role'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'role', 'company', 'brand', 'sales_channel'],
                name='unique_user_role_assignment',
            ),
        ]
        verbose_name = 'User Role Assignment'
        verbose_name_plural = 'User Role Assignments'

    def __str__(self):
        return f'{self.user} → {self.role.name} @ {self.scope_display}'

    @property
    def scope_display(self) -> str:
        if self.sales_channel_id:
            return f'Channel: {self.sales_channel}'
        if self.brand_id:
            return f'Brand: {self.brand}'
        if self.company_id:
            return f'Company: {self.company}'
        return 'Platform'

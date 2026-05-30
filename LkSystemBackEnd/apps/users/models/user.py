"""
LkSystem Users App - User Model
Custom user model with matricule as USERNAME_FIELD.
Supports multi-brand access within a single company.
"""

from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import RegexValidator


class UserManager(BaseUserManager):
    """
    Custom user manager for User model without username field.
    Uses matricule as the unique identifier.
    """
    
    def create_user(self, matricule, email, password=None, **extra_fields):
        """Create and return a regular user."""
        if not matricule:
            raise ValueError('The Matricule field is required')
        if not email:
            raise ValueError('The Email field is required')
        
        email = self.normalize_email(email)
        user = self.model(matricule=matricule, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user
    
    def create_superuser(self, matricule, email, password=None, **extra_fields):
        """Create and return a superuser."""
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        
        return self.create_user(matricule, email, password, **extra_fields)


class User(AbstractUser):
    """
    Custom User model for LkSystem ERP.
    
    - Uses matricule instead of username for authentication.
    - Belongs to ONE Company (current_company).
    - Can access MULTIPLE Brands within that company (allowed_brands M2M).
    - RBAC system (apps.rbac) controls permissions and brand switching.
    """
    
    # Remove username field - we use matricule instead
    username = None
    
    # Primary identifier - Generated from Company abbreviation
    matricule = models.CharField(
        max_length=20,
        unique=True,
        verbose_name='Matricule',
        help_text='Unique employee identifier (e.g., COMP-0001)',
        validators=[
            RegexValidator(
                regex=r'^[A-Z0-9\-]+$',
                message='Matricule must contain only uppercase letters, numbers, and hyphens'
            )
        ]
    )
    
    # Email - Required and unique
    email = models.EmailField(
        unique=True,
        verbose_name='Email Address'
    )
    
    # Company association - User belongs to ONE company
    current_company = models.ForeignKey(
        'company.Company',  # String reference to avoid circular import
        on_delete=models.PROTECT,
        related_name='employees',
        null=True,
        blank=True,
        verbose_name='Company',
        help_text='The company this user belongs to'
    )
    
    # Multi-brand access - User can access multiple brands within their company
    allowed_brands = models.ManyToManyField(
        'brands.Brand',  # String reference to avoid circular import
        blank=True,
        related_name='allowed_users',
        verbose_name='Allowed Brands',
        help_text='Brands this user can access (must belong to current_company)'
    )

    # Active brand workspace (sub-workspace inside current_company). NULL means
    # "whole company" (no brand focus). Set only through the validated
    # workspace-switch endpoint; when set, data scoping narrows to this brand.
    current_brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
        verbose_name='Active Brand',
        help_text='Active brand workspace; must belong to current_company.'
    )
    
    # Additional fields
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    
    # Timestamps
    date_joined = models.DateTimeField(auto_now_add=True)
    last_login = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Manager
    objects = UserManager()
    
    # Auth configuration
    USERNAME_FIELD = 'matricule'
    REQUIRED_FIELDS = ['email']
    
    class Meta:
        app_label = 'users'
        db_table = 'users_user'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        ordering = ['matricule']
    
    def __str__(self):
        return f"{self.matricule} - {self.get_full_name() or self.email}"
    
    def get_full_name(self):
        """Return first_name + last_name."""
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name if full_name else self.matricule
    
    def get_short_name(self):
        """Return the first name."""
        return self.first_name or self.matricule
    
    def can_switch_brands(self):
        """Check if user has RBAC permission to switch between brands."""
        from apps.rbac.services import PermissionService
        return 'switch_brands' in PermissionService.get_user_permissions(self)
    
    def get_allowed_brand_ids(self):
        """
        Get the list of brand IDs this user can access.
        
        Returns:
            - All allowed brand IDs if user can switch brands
            - Only the first brand ID if user cannot switch brands
            - Empty list if no brands assigned
        """
        brand_ids = list(self.allowed_brands.values_list('id', flat=True))
        
        if not brand_ids:
            return []
        
        if self.can_switch_brands():
            return brand_ids
        else:
            # User is locked to first brand only
            return [brand_ids[0]]
    
    def get_default_brand(self):
        """Get the default (first) brand for this user."""
        return self.allowed_brands.first()
    
    def save(self, *args, **kwargs):
        """Normalise matricule: strip surrounding whitespace, force uppercase.

        Without ``.strip()`` a trailing space on the input form survives the
        ``upper()`` call and the regex validator on the field then rejects
        it — or worse, the row saves with an invisible trailing space and
        every subsequent login lookup fails silently.
        """
        if self.matricule:
            self.matricule = self.matricule.strip().upper()
        super().save(*args, **kwargs)

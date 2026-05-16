"""
LkSystem Users App - Password Reset Token Model
Secure token-based password reset functionality.
"""

import secrets
from datetime import timedelta
from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model


def get_default_expiry():
    """Return default expiry time (1 hour from now)."""
    return timezone.now() + timedelta(hours=1)


class PasswordResetToken(models.Model):
    """
    Secure password reset token model.
    
    - Tokens expire after 1 hour
    - Only one active token per user
    - Token is hashed for security
    - Tracks usage and expiration
    """
    
    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='password_reset_tokens',
        verbose_name='User'
    )
    
    # Token - stored as hash, actual token sent via email
    token = models.CharField(
        max_length=64,
        unique=True,
        verbose_name='Reset Token'
    )
    
    # Expiration
    expires_at = models.DateTimeField(
        default=get_default_expiry,
        verbose_name='Expires At'
    )
    
    # Usage tracking
    is_used = models.BooleanField(
        default=False,
        verbose_name='Token Used'
    )
    used_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Used At'
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name='Request IP Address'
    )
    
    class Meta:
        app_label = 'users'
        db_table = 'users_password_reset_token'
        verbose_name = 'Password Reset Token'
        verbose_name_plural = 'Password Reset Tokens'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Reset token for {self.user.email} (expires: {self.expires_at})"
    
    @property
    def is_valid(self):
        """Check if token is still valid (not expired and not used)."""
        return not self.is_used and timezone.now() < self.expires_at
    
    @classmethod
    def generate_token(cls):
        """Generate a secure random token."""
        return secrets.token_urlsafe(32)
    
    @classmethod
    def create_for_user(cls, user, ip_address=None):
        """
        Create a new reset token for a user.
        Invalidates any existing tokens for the same user.
        """
        # Invalidate existing tokens
        cls.objects.filter(user=user, is_used=False).update(is_used=True)
        
        # Create new token
        token = cls.generate_token()
        reset_token = cls.objects.create(
            user=user,
            token=token,
            ip_address=ip_address
        )
        
        return reset_token, token
    
    def mark_as_used(self):
        """Mark the token as used."""
        self.is_used = True
        self.used_at = timezone.now()
        self.save(update_fields=['is_used', 'used_at'])
    
    @classmethod
    def cleanup_expired(cls):
        """Delete expired and used tokens (older than 24 hours)."""
        cutoff = timezone.now() - timedelta(hours=24)
        return cls.objects.filter(
            models.Q(expires_at__lt=timezone.now()) | 
            models.Q(is_used=True, used_at__lt=cutoff)
        ).delete()

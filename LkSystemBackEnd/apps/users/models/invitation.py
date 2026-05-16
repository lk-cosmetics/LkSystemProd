"""
LkSystem Users App - Employee Invitation Model
Token-based invitation flow for onboarding new employees.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def get_invitation_expiry():
    """Invitation links expire after 72 hours."""
    return timezone.now() + timedelta(hours=72)


class Invitation(models.Model):
    """
    Stores a pending employee invitation.

    Flow:
      1. Admin/CEO/Manager creates invitation → email sent with link
      2. Invited user opens link → validates token
      3. User fills registration form (name, password)
      4. System creates User, assigns RBAC role + scope
    """

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        ACCEPTED = 'ACCEPTED', 'Accepted'
        EXPIRED = 'EXPIRED', 'Expired'
        CANCELLED = 'CANCELLED', 'Cancelled'

    # ── Token ──────────────────────────────────────────────────────────
    token = models.CharField(max_length=64, unique=True)
    email = models.EmailField(verbose_name='Invited Email')
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    expires_at = models.DateTimeField(default=get_invitation_expiry)

    # ── Pre-assigned scope (set by the inviter) ────────────────────────
    role = models.ForeignKey(
        'rbac.Role',
        on_delete=models.CASCADE,
        related_name='invitations',
        verbose_name='Assigned Role',
    )
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='invitations',
        verbose_name='Company',
    )
    brands = models.ManyToManyField(
        'brands.Brand',
        blank=True,
        related_name='invitations',
        verbose_name='Assigned Brands',
    )
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invitations',
        verbose_name='Assigned Sales Channel',
    )

    # ── Audit ──────────────────────────────────────────────────────────
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='sent_invitations',
    )
    accepted_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accepted_invitation',
        help_text='The User created when invitation was accepted.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = 'users'
        db_table = 'users_invitation'
        ordering = ['-created_at']

    def __str__(self):
        return f"Invitation for {self.email} ({self.get_status_display()})"

    # ── Helpers ─────────────────────────────────────────────────────────

    @property
    def is_valid(self):
        return self.status == self.Status.PENDING and timezone.now() < self.expires_at

    @classmethod
    def generate_token(cls):
        return secrets.token_urlsafe(32)

    @classmethod
    def create_invitation(cls, *, email, role, company, invited_by,
                          brands=None, sales_channel=None):
        """
        Create a new invitation. Cancels any previous pending invitation
        for the same email.
        """
        # Cancel previous pending invitations for this email
        cls.objects.filter(
            email=email.lower(),
            status=cls.Status.PENDING,
        ).update(status=cls.Status.CANCELLED)

        invitation = cls.objects.create(
            token=cls.generate_token(),
            email=email.lower(),
            role=role,
            company=company,
            sales_channel=sales_channel,
            invited_by=invited_by,
        )

        if brands:
            invitation.brands.set(brands)

        return invitation

    def mark_accepted(self, user):
        self.status = self.Status.ACCEPTED
        self.accepted_user = user
        self.accepted_at = timezone.now()
        self.save(update_fields=['status', 'accepted_user', 'accepted_at'])

    def cancel(self):
        self.status = self.Status.CANCELLED
        self.save(update_fields=['status'])

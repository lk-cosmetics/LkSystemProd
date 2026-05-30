"""
LkSystem Notifications App - Models

Two-table fan-out so the same logical event scales to many recipients without
duplicating its (potentially heavy) payload:

* ``Notification``          — one row per event. Holds the shared payload
                              (title / body / link / metadata) once.
* ``NotificationRecipient`` — one row per (notification, user). Holds the
                              *per-user* read state plus a few denormalized
                              columns (category / priority / created_at) so the
                              inbox list, unread count and all filters are a
                              single-table, fully-indexed query — no join, no
                              N+1 — even at 1000+ notifications/day.

Targeting (which users get a recipient row) is resolved by
``NotificationService`` against the RBAC role model; see ``services.py``.
"""

from django.conf import settings
from django.db import models


class Notification(models.Model):
    """A single notification event with its shared, recipient-independent payload."""

    class Category(models.TextChoices):
        ORDER    = 'order',    'Order'
        SYNC     = 'sync',     'Synchronization'
        STOCK    = 'stock',    'Stock'
        RETURN   = 'return',   'Return'
        EXCHANGE = 'exchange', 'Exchange'
        SYSTEM   = 'system',   'System'

    class Priority(models.TextChoices):
        LOW    = 'low',    'Low'
        NORMAL = 'normal', 'Normal'
        HIGH   = 'high',   'High'
        URGENT = 'urgent', 'Urgent'

    class TargetType(models.TextChoices):
        USER       = 'user',       'Single user'
        ROLE       = 'role',       'Single role'
        MULTI_ROLE = 'multi_role', 'Multiple roles'
        GLOBAL     = 'global',     'All users'

    # Tenant scope. NULL only for genuine platform-wide notifications.
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='notifications',
        null=True,
        blank=True,
        help_text='Owning company. NULL = platform-wide.',
    )

    category = models.CharField(max_length=20, choices=Category.choices)
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.NORMAL,
    )

    title = models.CharField(max_length=255)
    body  = models.TextField(blank=True, default='')

    # How the audience was selected (audit / debugging only — the actual
    # delivery is materialized as NotificationRecipient rows).
    target_type  = models.CharField(
        max_length=20, choices=TargetType.choices, default=TargetType.ROLE,
    )
    target_roles = models.JSONField(
        default=list, blank=True,
        help_text='Role names the audience was resolved from (audit).',
    )

    # Deep-link so the frontend can open the related page on click.
    link_url    = models.CharField(max_length=512, blank=True, default='')
    entity_type = models.CharField(
        max_length=32, blank=True, default='',
        help_text="e.g. 'order', 'product', 'inventory', 'setting'.",
    )
    entity_id   = models.CharField(max_length=64, blank=True, default='')

    metadata = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='+',
        help_text='User who triggered the event, if any.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notification'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['company', 'category'], name='notif_company_cat_idx'),
            models.Index(fields=['company', '-created_at'], name='notif_company_created_idx'),
        ]
        verbose_name = 'Notification'
        verbose_name_plural = 'Notifications'

    def __str__(self):
        return f'[{self.category}/{self.priority}] {self.title}'


class NotificationRecipient(models.Model):
    """
    Per-user delivery + read state for one notification.

    ``category`` / ``priority`` / ``created_at`` are denormalized from the
    parent ``Notification`` so that every inbox query (list, filter, unread
    count, ordering) hits this single table through a leading-``user`` index
    and never has to join. The heavy payload (title/body/metadata) is fetched
    via ``select_related('notification')`` only for the current page.
    """

    notification = models.ForeignKey(
        Notification,
        on_delete=models.CASCADE,
        related_name='recipients',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notification_recipients',
    )

    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    # Denormalized from Notification for single-table, indexed inbox queries.
    category   = models.CharField(max_length=20)
    priority   = models.CharField(max_length=10)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'notification_recipient'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['notification', 'user'],
                name='uniq_notification_recipient',
            ),
        ]
        indexes = [
            # Default inbox listing for a user (newest first).
            models.Index(fields=['user', '-created_at'], name='notif_rcpt_user_created_idx'),
            # Unread count + "unread only" filter.
            models.Index(fields=['user', 'is_read', '-created_at'], name='notif_rcpt_user_unread_idx'),
            # Category filter.
            models.Index(fields=['user', 'category', '-created_at'], name='notif_rcpt_user_cat_idx'),
            # Priority filter.
            models.Index(fields=['user', 'priority', '-created_at'], name='notif_rcpt_user_prio_idx'),
        ]
        verbose_name = 'Notification Recipient'
        verbose_name_plural = 'Notification Recipients'

    def __str__(self):
        state = 'read' if self.is_read else 'unread'
        return f'{self.user_id} · {self.notification_id} ({state})'

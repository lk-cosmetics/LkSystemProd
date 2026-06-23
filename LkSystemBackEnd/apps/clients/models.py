"""
LkSystem Clients App - Models
Client entity auto-registered from WooCommerce orders or POS transactions.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from .utils import normalize_tunisian_phone


class Client(models.Model):
    """
    Client / Customer profile.

    Auto-created when an order arrives with an unknown billing_email.
    """

    # A client is auto-blocked once they reach this many returned orders.
    RETURN_BLOCK_THRESHOLD = 4
    # Reason stamped on a client that crosses the return threshold.
    AUTO_BLOCK_REASON = 'Max returned orders reached.'

    class Source(models.TextChoices):
        WOOCOMMERCE = 'WOOCOMMERCE', 'WooCommerce'
        POS = 'POS', 'Point of Sale'
        MANUAL = 'MANUAL', 'Manual Entry'

    class ClientType(models.TextChoices):
        PERSON = 'PERSON', 'Person'
        COMPANY = 'COMPANY', 'Company'


    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='clients',
        verbose_name='Company',
        help_text='Tenant that owns this client record',
    )

    # ── Brand & Reseller ─────────────────────────────────────────────────
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='clients',
        verbose_name='Brand',
        help_text='Brand this client is associated with',
    )
    reseller = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='referred_clients',
        verbose_name='Reseller',
        help_text='Reseller who referred this client',
    )

    # ── Identity ─────────────────────────────────────────────────────────
    email = models.EmailField(
        verbose_name='Email',
        help_text='Billing e-mail (unique per company)',
    )
    first_name = models.CharField(max_length=150, blank=True, default='')
    last_name = models.CharField(max_length=150, blank=True, default='')
    phone = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        default=None,
        unique=True,
        db_index=True,
    )
    phone_normalized = models.CharField(
        max_length=20,
        blank=True,
        default='',
        db_index=True,
        help_text='Normalized phone key used for duplicate detection.',
    )
    client_type = models.CharField(
        max_length=20,
        choices=ClientType.choices,
        default=ClientType.PERSON,
        db_index=True,
    )
    # Tax ID for business (COMPANY-type) clients — shown as the bill-to tax
    # number on invoices. Optional; individuals leave it blank.
    matricule_fiscale = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name='Matricule Fiscale',
        help_text='Tax registration number for business clients (shown on invoices).',
    )
    date_of_birth = models.DateField(null=True, blank=True)

    # ── Address ──────────────────────────────────────────────────────────
    address = models.TextField(blank=True, default='')
    city = models.CharField(max_length=100, blank=True, default='')
    state = models.CharField(max_length=100, blank=True, default='')
    postcode = models.CharField(max_length=20, blank=True, default='')
    country = models.CharField(max_length=5, blank=True, default='TN')

    # ── WooCommerce link ─────────────────────────────────────────────────
    wc_customer_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='WooCommerce Customer ID',
    )

    # ── Source / provenance ──────────────────────────────────────────────
    source = models.CharField(
        max_length=20,
        choices=Source.choices,
        default=Source.MANUAL,
        verbose_name='Source',
    )
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='clients',
        verbose_name='Originating Channel',
    )

    # ── Metrics ──────────────────────────────────────────────────────────
    points = models.PositiveIntegerField(
        default=0,
        verbose_name='Loyalty Points',
    )
    number_of_orders = models.PositiveIntegerField(
        default=0,
        verbose_name='Number of Orders',
    )
    number_of_returns = models.PositiveIntegerField(
        default=0,
        verbose_name='Number of Returns',
    )
    is_blocked = models.BooleanField(
        default=False,
        verbose_name='Blocked',
        help_text='Set automatically when returns reach the threshold, or manually.',
    )
    blocked_reason = models.CharField(
        max_length=255,
        blank=True,
        default='',
        verbose_name='Block Reason',
        help_text='Why the client is blocked (auto or manual). Empty when not blocked.',
    )
    blocked_at = models.DateTimeField(
        null=True, blank=True,
        verbose_name='Blocked At',
    )
    blocked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='clients_blocked',
        help_text='User who blocked the client manually; NULL for an automatic block.',
    )

    # ── Metadata ─────────────────────────────────────────────────────────
    notes = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='clients_created',
    )

    class Meta:
        app_label = 'clients'
        db_table = 'client'
        verbose_name = 'Client'
        verbose_name_plural = 'Clients'
        ordering = ['-created_at']
        unique_together = [('company', 'email')]
        indexes = [
            models.Index(fields=['company', 'email'], name='client_company_597da1_idx'),
            models.Index(fields=['wc_customer_id'], name='client_wc_cust_b9e1a8_idx'),
            models.Index(fields=['company', 'phone_normalized'], name='client_company_phone_norm_idx'),
            models.Index(fields=['company', 'client_type'], name='client_company_type_idx'),
            models.Index(fields=['brand'], name='client_brand_i_9eb375_idx'),
            models.Index(fields=['is_blocked'], name='client_is_bloc_329548_idx'),
        ]

    def __str__(self):
        name = f"{self.first_name} {self.last_name}".strip() or self.email
        return name

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.email

    @property
    def governorate(self):
        return self.state

    def recalculate_metrics(self, *, save: bool = True):
        """Recompute counters and loyalty points from this client's orders.

        Loyalty points are EARNED ONLY on completed (``done``) orders. They are
        DERIVED here from the current set of done, non-deleted orders — never
        added while an order is still pending/processing/preparing, and removed
        automatically when an order leaves ``done`` (canceled, returned,
        exchanged) or is soft-deleted. Deriving the total rather than mutating
        it per event makes points self-healing: ``points`` can never drift away
        from the orders that justify them, and this method is the single writer
        of ``client.points``.
        """
        from decimal import Decimal

        from django.conf import settings
        from django.db.models import Count, Q, Sum

        from apps.orders.models import Order

        qs = Order.all_objects.filter(client=self, is_deleted=False)
        agg = qs.aggregate(
            # Money from DONE orders only — the basis for loyalty points.
            done_total=Sum(
                'total',
                filter=Q(status=Order.Status.DONE),
            ),
            order_count=Count('id'),
            return_count=Count(
                'id',
                filter=(
                    Q(source=Order.Source.WOOCOMMERCE)
                    & (
                        Q(returned_at__isnull=False)
                        | Q(status=Order.Status.RETURNED)
                    )
                ),
            ),
        )
        per_unit = Decimal(str(getattr(settings, 'LOYALTY_POINTS_PER_UNIT', 1)))
        done_total = agg['done_total'] or Decimal('0')
        self.points = int(done_total * per_unit) if per_unit > 0 else 0
        self.number_of_orders = agg['order_count'] or 0
        self.number_of_returns = agg['return_count'] or 0
        # Auto-block is applied in save() — BLOCK-ONLY, so it never unblocks a
        # client whose return count drops, and a manual block is preserved.
        if save:
            self.save(update_fields=[
                'points', 'number_of_orders', 'number_of_returns',
                'is_blocked', 'phone_normalized', 'updated_at',
            ])
        return self

    def apply_auto_block(self) -> bool:
        """Block the client (with the auto reason) once returns reach the
        threshold. Idempotent and BLOCK-ONLY — it never unblocks, so a manual
        block survives metric recalculations. Returns True if it just blocked."""
        if self.number_of_returns >= self.RETURN_BLOCK_THRESHOLD and not self.is_blocked:
            self.is_blocked = True
            self.blocked_reason = self.blocked_reason or self.AUTO_BLOCK_REASON
            self.blocked_at = self.blocked_at or timezone.now()
            return True
        return False

    def block(self, *, reason: str = '', by=None):
        """Manually block the client with a reason + audit stamp."""
        self.is_blocked = True
        self.blocked_reason = (reason or '').strip() or 'Blocked manually.'
        self.blocked_at = timezone.now()
        self.blocked_by = by

    def unblock(self):
        """Clear the block and its reason / audit fields."""
        self.is_blocked = False
        self.blocked_reason = ''
        self.blocked_at = None
        self.blocked_by = None

    def save(self, *args, **kwargs):
        """Normalise the phone and auto-block once returns reach the threshold.

        When the auto-block flips fields, ensure the block columns persist even
        for a restricted ``update_fields`` save (e.g. the returns-counter bump in
        ``OrderLifecycleService.process_return``)."""
        self.phone_normalized = normalize_tunisian_phone(self.phone)
        newly_blocked = self.apply_auto_block()
        if newly_blocked:
            uf = kwargs.get('update_fields')
            if uf is not None:
                kwargs['update_fields'] = sorted(
                    set(uf) | {'is_blocked', 'blocked_reason', 'blocked_at'}
                )
        super().save(*args, **kwargs)

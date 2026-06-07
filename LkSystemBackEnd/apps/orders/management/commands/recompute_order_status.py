"""Recompute order_status for POS-validated orders left in a non-terminal state.

A completed POS checkout must reach ``order_status='done'`` so it appears in POS
history, earns loyalty points and leaves the priority queue. Direct POS sales
historically set ``pos_validated_at`` without recomputing the canonical status,
so some are stuck at ``'new'``. This re-derives them via the lifecycle service
(the single source of truth). Idempotent — safe to re-run.

    python manage.py recompute_order_status
    python manage.py recompute_order_status --dry-run
"""
from django.core.management.base import BaseCommand

from apps.orders.lifecycle_service import OrderLifecycleService
from apps.orders.models import Order


class Command(BaseCommand):
    help = (
        "Recompute order_status for POS-validated orders stuck in a "
        "non-terminal status (e.g. completed POS sales left at 'new')."
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='List affected orders without changing them.')

    def handle(self, *args, **options):
        OS = Order.OrderStatus
        terminal = [OS.DONE, OS.RETURNED, OS.CANCELED, OS.EXCHANGED]
        qs = (Order.objects
              .filter(pos_validated_at__isnull=False)
              .exclude(order_status__in=terminal)
              .order_by('id'))

        total = qs.count()
        self.stdout.write(f'{total} POS-validated order(s) with a stale order_status.')
        dry = options.get('dry_run')
        changed = 0

        for order in qs.iterator():
            before = order.order_status
            if dry:
                self.stdout.write(f'  [dry-run] order {order.id}: {before} → (recompute)')
                continue
            try:
                OrderLifecycleService._recompute_outcome(order)
                order.refresh_from_db(fields=['order_status'])
                if order.order_status != before:
                    changed += 1
                    self.stdout.write(f'  order {order.id}: {before} → {order.order_status}')
            except Exception as exc:  # noqa: BLE001 - report and continue
                self.stderr.write(f'  order {order.id}: failed — {exc}')

        if dry:
            self.stdout.write(self.style.WARNING('Dry run — nothing changed.'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Done. {changed}/{total} order(s) updated.'))

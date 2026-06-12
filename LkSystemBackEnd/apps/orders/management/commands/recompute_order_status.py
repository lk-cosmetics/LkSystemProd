"""Repair canonical status for POS-validated orders left mid-pipeline.

A completed POS checkout must reach ``status='done'`` so it appears in
POS history, earns loyalty points and leaves the priority queue. The status is
no longer derived — it moves only via OrderStatusService.transition() — so this
repair issues an explicit forced (audited) transition. Idempotent — safe to
re-run.

    python manage.py recompute_order_status
    python manage.py recompute_order_status --dry-run
"""
from django.core.management.base import BaseCommand

from apps.orders.models import Order
from apps.orders.status_service import OrderStatusService


class Command(BaseCommand):
    help = (
        "Move POS-validated orders stuck mid-pipeline (e.g. completed POS "
        "sales left at 'new') to the canonical 'done' status."
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='List affected orders without changing them.')

    def handle(self, *args, **options):
        qs = (Order.objects
              .filter(pos_validated_at__isnull=False)
              .exclude(status=Order.Status.DONE)
              .order_by('id'))

        total = qs.count()
        self.stdout.write(f'{total} POS-validated order(s) with a stale status.')
        dry = options.get('dry_run')
        changed = 0

        for order in qs.iterator():
            before = order.status
            if dry:
                self.stdout.write(f'  [dry-run] order {order.id}: {before} → done')
                continue
            try:
                OrderStatusService.transition(
                    order, Order.Status.DONE,
                    note='repair: POS-validated order left mid-pipeline',
                    force=True,
                )
                changed += 1
                self.stdout.write(f'  order {order.id}: {before} → done')
            except Exception as exc:  # noqa: BLE001 - report and continue
                self.stderr.write(f'  order {order.id}: failed — {exc}')

        if dry:
            self.stdout.write(self.style.WARNING('Dry run — nothing changed.'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Done. {changed}/{total} order(s) updated.'))

"""Backfill Order.final_outcome for rows created before migration 0011.

Walks every Order (including soft-deleted) and applies the same derivation
the lifecycle service uses at transition time, so historical KPI counts
become consistent with the new contract.

Run after applying migration 0011:
    python manage.py backfill_final_outcome
    python manage.py backfill_final_outcome --dry-run
    python manage.py backfill_final_outcome --batch-size 500
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.orders.lifecycle_service import OrderLifecycleService
from apps.orders.models import Order


class Command(BaseCommand):
    help = 'Backfill Order.final_outcome based on the current state of other status fields.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Compute counts only, do not save.')
        parser.add_argument('--batch-size', type=int, default=200, help='Save in batches of N rows.')
        parser.add_argument(
            '--only-none',
            action='store_true',
            help='Only touch rows currently at final_outcome=NONE (skip already-set rows).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        batch = options['batch_size']
        only_none = options['only_none']

        qs = Order.all_objects.all()
        if only_none:
            qs = qs.filter(final_outcome=Order.FinalOutcome.NONE)

        total = qs.count()
        changed = 0
        unchanged = 0
        counters: dict[str, int] = {}

        self.stdout.write(f'Scanning {total} orders...')

        updates: list[Order] = []
        for order in qs.iterator(chunk_size=batch):
            new_outcome = OrderLifecycleService._derive_final_outcome(order)
            counters[new_outcome] = counters.get(new_outcome, 0) + 1
            if new_outcome == order.final_outcome:
                unchanged += 1
                continue
            order.final_outcome = new_outcome
            updates.append(order)
            if not dry_run and len(updates) >= batch:
                with transaction.atomic():
                    Order.all_objects.bulk_update(updates, ['final_outcome'])
                changed += len(updates)
                updates = []

        if updates and not dry_run:
            with transaction.atomic():
                Order.all_objects.bulk_update(updates, ['final_outcome'])
            changed += len(updates)

        prefix = '[DRY RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}Total: {total}  changed: {changed}  unchanged: {unchanged}'
        ))
        for outcome, count in sorted(counters.items()):
            self.stdout.write(f'  {outcome}: {count}')

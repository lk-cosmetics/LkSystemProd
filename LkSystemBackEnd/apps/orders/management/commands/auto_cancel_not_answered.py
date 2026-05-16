"""python manage.py auto_cancel_not_answered [--days 3] [--dry-run]

Cron-friendly wrapper around AutoCancelService. Schedule daily via OS cron,
Windows Task Scheduler, or Celery Beat.
"""

from django.core.management.base import BaseCommand

from apps.orders.auto_cancel_service import AutoCancelService


class Command(BaseCommand):
    help = 'Auto-cancel orders that have been NOT_ANSWERED for N days (default 3).'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=None, help='Threshold in days (overrides ORDER_AUTO_CANCEL_DAYS).')
        parser.add_argument('--dry-run', action='store_true', help='Count without cancelling.')

    def handle(self, *args, **options):
        result = AutoCancelService.run(days=options['days'], dry_run=options['dry_run'])
        prefix = '[DRY RUN] ' if result.dry_run else ''
        self.stdout.write(
            self.style.SUCCESS(
                f'{prefix}Threshold: {result.days} days  '
                f'Candidates: {result.candidates}  '
                f'Cancelled: {result.cancelled}  '
                f'Failures: {len(result.failures)}'
            )
        )
        for fail in result.failures:
            self.stdout.write(self.style.ERROR(
                f"  - order {fail['order_number']} (id={fail['order_id']}): {fail['error']}"
            ))

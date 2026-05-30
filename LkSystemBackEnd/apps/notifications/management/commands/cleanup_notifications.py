"""
Delete notifications older than the configured retention window.

Deleting a ``Notification`` cascades to its ``NotificationRecipient`` rows, so
old per-user state is cleaned up in the same pass. Run from cron / Celery beat:

    python manage.py cleanup_notifications
    python manage.py cleanup_notifications --days 30 --dry-run
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.notifications.models import Notification


class Command(BaseCommand):
    help = 'Delete notifications older than NOTIFICATION_RETENTION_DAYS.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=None,
            help='Override NOTIFICATION_RETENTION_DAYS for this run.',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report how many rows would be deleted without deleting.',
        )

    def handle(self, *args, **options):
        days = options['days']
        if days is None:
            days = getattr(settings, 'NOTIFICATION_RETENTION_DAYS', 90)
        cutoff = timezone.now() - timedelta(days=days)

        qs = Notification.objects.filter(created_at__lt=cutoff)
        count = qs.count()

        if options['dry_run']:
            self.stdout.write(self.style.WARNING(
                f'[dry-run] would delete {count} notification(s) older than {days} days '
                f'(before {cutoff.isoformat()}).'
            ))
            return

        deleted, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(
            f'Deleted {count} notification(s) older than {days} days '
            f'({deleted} rows incl. recipients).'
        ))

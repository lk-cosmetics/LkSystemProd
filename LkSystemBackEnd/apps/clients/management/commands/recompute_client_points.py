"""Recompute every client's loyalty points and counters from their orders.

Loyalty points now reflect COMPLETED (done) orders only — pending/processing
orders never add points, and canceled/returned/exchanged/soft-deleted orders
never count. Run this once after deploying that change to correct historical
values that were computed from the sum of *all* orders.

    python manage.py recompute_client_points
    python manage.py recompute_client_points --company 1
"""
from django.core.management.base import BaseCommand

from apps.clients.models import Client


class Command(BaseCommand):
    help = (
        "Recompute every client's loyalty points and counters from their "
        "orders (points reflect completed/done orders only)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--company', type=int, default=None,
            help='Limit the recompute to a single company id.',
        )

    def handle(self, *args, **options):
        qs = Client.objects.all()
        company_id = options.get('company')
        if company_id:
            qs = qs.filter(company_id=company_id)

        total = qs.count()
        self.stdout.write(f'Recomputing loyalty points for {total} client(s)…')

        changed = 0
        for client in qs.iterator():
            before = client.points
            client.recalculate_metrics()
            if client.points != before:
                changed += 1
                self.stdout.write(
                    f'  client {client.id} ({client.full_name}): '
                    f'{before} → {client.points}'
                )

        self.stdout.write(self.style.SUCCESS(
            f'Done. {changed}/{total} client(s) updated.'
        ))

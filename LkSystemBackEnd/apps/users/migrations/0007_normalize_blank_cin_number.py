"""Data migration: normalise blank ``Profile.cin_number`` values to NULL.

``cin_number`` is a unique CharField with ``blank=True, null=True``. Earlier
write paths stored an empty CIN as the empty string ``''`` instead of NULL.
Because ``''`` is a real value (unlike NULL, which Postgres treats as distinct),
only ONE profile could hold ``''`` — the second profile saved without a CIN hit
``duplicate key value violates unique constraint "users_profile_cin_number_key"``
and returned HTTP 500, which also blocked the role change that ran afterwards on
the Edit-User screen.

This converts every existing ``''`` to NULL so multiple "no CIN" profiles can
coexist. The model's ``save()`` now performs the same normalisation for all
future writes.
"""

from django.db import migrations


def blank_cin_to_null(apps, schema_editor):
    Profile = apps.get_model('users', 'Profile')
    Profile.objects.filter(cin_number='').update(cin_number=None)


def reverse_noop(apps, schema_editor):
    # Irreversible: a NULL CIN cannot be told apart from one that was ''
    # originally, so there is nothing safe to restore.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0006_user_assigned_sales_channel'),
    ]

    operations = [
        migrations.RunPython(blank_cin_to_null, reverse_noop),
    ]

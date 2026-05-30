"""
Celery tasks for the notifications app.

Currently just the retention cleanup, delegating to the management command so
there is a single implementation. Schedule it from Celery beat, e.g. daily:

    CELERY_BEAT_SCHEDULE = {
        'cleanup-notifications': {
            'task': 'notifications.cleanup_notifications',
            'schedule': crontab(hour=3, minute=0),
        },
    }

Import is guarded so the module never breaks app loading if Celery is absent.
"""

try:
    from celery import shared_task
except Exception:  # pragma: no cover - Celery optional
    shared_task = None


if shared_task is not None:

    @shared_task(name='notifications.cleanup_notifications')
    def cleanup_notifications_task(days=None):
        from django.core.management import call_command
        if days is not None:
            call_command('cleanup_notifications', days=days)
        else:
            call_command('cleanup_notifications')

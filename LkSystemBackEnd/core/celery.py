"""
LkSystem - Celery Application
═══════════════════════════════════════════════════════════════════════════════
Celery is OPTIONAL. The app runs perfectly without it — background tasks
degrade gracefully to synchronous execution when Celery is not configured.

To enable Celery:
    1. Install: pip install celery redis
    2. Set env vars:
         CELERY_BROKER_URL=redis://localhost:6379/1
         CELERY_RESULT_BACKEND=redis://localhost:6379/1
    3. Start the worker:
         celery -A core worker -l info
    4. Start beat (periodic tasks):
         celery -A core beat -l info

Queues:
    default   – general purpose
    orders    – order sync tasks (can be scaled independently)
    delivery  – delivery submission tasks
"""

import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

app = Celery('lksystem')

# Read config from Django settings, namespace avoids conflicts with other libs
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all INSTALLED_APPS
app.autodiscover_tasks()


# ─── Periodic beat schedule ───────────────────────────────────────────────────

app.conf.beat_schedule = {
    # Pull orders from all active WooCommerce channels every 15 minutes
    'sync-all-wc-channels': {
        'task':     'orders.sync_all_channels',
        'schedule': crontab(minute='*/15'),
    },
    # Retry any stuck FAILED delivery orders every 30 minutes
    'retry-failed-deliveries': {
        'task':     'orders.retry_failed_deliveries',
        'schedule': crontab(minute='*/30'),
    },
}

app.conf.timezone = 'UTC'


# ─── Debug task ───────────────────────────────────────────────────────────────

@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

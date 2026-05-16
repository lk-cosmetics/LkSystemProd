#!/usr/bin/env python
"""
Check webhook payload logs to understand what's being sent.
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from core.webhooks.models import WebhookLog, WebhookPayload

print("\n" + "="*80)
print("WEBHOOK PROCESSING LOGS")
print("="*80)

# 1. Check recent logs
print("\n1. RECENT WEBHOOK LOGS (Last 20)")
print("-" * 80)
logs = WebhookLog.objects.all().order_by('-created_at')[:20]
for log in logs:
    print(f"\nLog ID: {log.id}")
    print(f"  ├─ Topic: {log.topic}")
    print(f"  ├─ Status: {log.status}")
    print(f"  ├─ Response: {log.response_data}")
    print(f"  ├─ Error: {log.error_message}")
    print(f"  └─ Created: {log.created_at}")

# 2. Check payloads
print("\n\n2. RECENT WEBHOOK PAYLOADS (Last 10)")
print("-" * 80)
payloads = WebhookPayload.objects.all().order_by('-received_at')[:10]
for payload in payloads:
    print(f"\nPayload ID: {payload.id}")
    print(f"  ├─ Topic: {payload.topic}")
    print(f"  ├─ Source: {payload.source}")
    print(f"  ├─ Size: {len(str(payload.data))} bytes")
    print(f"  ├─ Processed: {payload.processed}")
    print(f"  └─ Data Keys: {list(payload.data.keys())}")

# 3. Summary
print("\n\n3. SUMMARY")
print("-" * 80)
print(f"Total WebhookLogs: {WebhookLog.objects.count()}")
print(f"Total WebhookPayloads: {WebhookPayload.objects.count()}")
print(f"Failed logs: {WebhookLog.objects.filter(status='failed').count()}")
print(f"Processed payloads: {WebhookPayload.objects.filter(processed=True).count()}")

# 4. Check by topic
print("\n4. LOGS BY TOPIC")
print("-" * 80)
from django.db.models import Count
topics = WebhookLog.objects.values('topic').annotate(count=Count('id')).order_by('-count')
for topic_data in topics:
    failed = WebhookLog.objects.filter(topic=topic_data['topic'], status='failed').count()
    print(f"  {topic_data['topic']:30} : {topic_data['count']:3} total | {failed:3} failed")

print("\n" + "="*80 + "\n")

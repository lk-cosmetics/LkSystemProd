"""
Initial schema for the notifications app.

Purely additive: creates two new tables (``notification`` and
``notification_recipient``) and their indexes. Touches no existing table,
so it is safe to apply to the running database.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('company', '__first__'),
    ]

    operations = [
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category', models.CharField(choices=[('order', 'Order'), ('sync', 'Synchronization'), ('stock', 'Stock'), ('return', 'Return'), ('exchange', 'Exchange'), ('system', 'System')], max_length=20)),
                ('priority', models.CharField(choices=[('low', 'Low'), ('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')], default='normal', max_length=10)),
                ('title', models.CharField(max_length=255)),
                ('body', models.TextField(blank=True, default='')),
                ('target_type', models.CharField(choices=[('user', 'Single user'), ('role', 'Single role'), ('multi_role', 'Multiple roles'), ('global', 'All users')], default='role', max_length=20)),
                ('target_roles', models.JSONField(blank=True, default=list, help_text='Role names the audience was resolved from (audit).')),
                ('link_url', models.CharField(blank=True, default='', max_length=512)),
                ('entity_type', models.CharField(blank=True, default='', help_text="e.g. 'order', 'product', 'inventory', 'setting'.", max_length=32)),
                ('entity_id', models.CharField(blank=True, default='', max_length=64)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('company', models.ForeignKey(blank=True, help_text='Owning company. NULL = platform-wide.', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='company.company')),
                ('created_by', models.ForeignKey(blank=True, help_text='User who triggered the event, if any.', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Notification',
                'verbose_name_plural': 'Notifications',
                'db_table': 'notification',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='NotificationRecipient',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_read', models.BooleanField(default=False)),
                ('read_at', models.DateTimeField(blank=True, null=True)),
                ('category', models.CharField(max_length=20)),
                ('priority', models.CharField(max_length=10)),
                ('created_at', models.DateTimeField()),
                ('notification', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='recipients', to='notifications.notification')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notification_recipients', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Notification Recipient',
                'verbose_name_plural': 'Notification Recipients',
                'db_table': 'notification_recipient',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['company', 'category'], name='notif_company_cat_idx'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['company', '-created_at'], name='notif_company_created_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationrecipient',
            index=models.Index(fields=['user', '-created_at'], name='notif_rcpt_user_created_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationrecipient',
            index=models.Index(fields=['user', 'is_read', '-created_at'], name='notif_rcpt_user_unread_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationrecipient',
            index=models.Index(fields=['user', 'category', '-created_at'], name='notif_rcpt_user_cat_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationrecipient',
            index=models.Index(fields=['user', 'priority', '-created_at'], name='notif_rcpt_user_prio_idx'),
        ),
        migrations.AddConstraint(
            model_name='notificationrecipient',
            constraint=models.UniqueConstraint(fields=['notification', 'user'], name='uniq_notification_recipient'),
        ),
    ]

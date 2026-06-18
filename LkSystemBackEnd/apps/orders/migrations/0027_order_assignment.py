import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('company', '0001_initial'),
        ('orders', '0026_explicit_invoice_snapshots'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='assigned_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='orders_assigned_by',
                to=settings.AUTH_USER_MODEL,
                help_text='User who performed the assignment (NULL = system / auto).',
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='assigned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='assignment_type',
            field=models.CharField(
                blank=True,
                default='',
                max_length=10,
                choices=[('auto', 'Automatic'), ('manual', 'Manual')],
                help_text='How assigned_agent was set: auto (on import) or manual.',
            ),
        ),
        migrations.AlterField(
            model_name='order',
            name='assigned_agent',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_orders',
                to=settings.AUTH_USER_MODEL,
                help_text='Employee responsible for processing this order.',
            ),
        ),
        migrations.CreateModel(
            name='OrderAutoAssignmentSetting',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=True, help_text='When true, this employee is eligible for automatic assignment.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('company', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='auto_assignment_settings', to='company.company')),
                ('employee', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='auto_assignment_settings', to=settings.AUTH_USER_MODEL)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='auto_assignment_settings_created', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='auto_assignment_settings_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Auto Assignment Setting',
                'verbose_name_plural': 'Auto Assignment Settings',
                'db_table': 'order_auto_assignment_setting',
            },
        ),
        migrations.AddIndex(
            model_name='orderautoassignmentsetting',
            index=models.Index(fields=['company', 'enabled'], name='order_auto_company_enabled_idx'),
        ),
        migrations.AddConstraint(
            model_name='orderautoassignmentsetting',
            constraint=models.UniqueConstraint(fields=('company', 'employee'), name='uniq_auto_assignment_company_employee'),
        ),
    ]

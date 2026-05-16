"""POS caisse dépense (expense) table."""

from decimal import Decimal

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0007_delivery_api_key_text'),
        ('company', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Expense',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14)),
                ('category', models.CharField(
                    choices=[
                        ('SUPPLIES', 'Supplies / Fournitures'),
                        ('UTILITY', 'Utility / Facture'),
                        ('TRANSPORT', 'Transport / Livraison'),
                        ('SALARY', 'Salary / Salaire'),
                        ('MAINTENANCE', 'Maintenance / Réparation'),
                        ('REFUND', 'Refund / Remboursement client'),
                        ('OTHER', 'Other / Autre'),
                    ],
                    default='OTHER', max_length=24,
                )),
                ('note', models.TextField(blank=True, default='')),
                ('occurred_at', models.DateTimeField(db_index=True, help_text='When the cash left the till.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('company', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='expenses', to='company.company')),
                ('sales_channel', models.ForeignKey(
                    help_text='POS register the dépense was paid from.',
                    on_delete=models.deletion.CASCADE, related_name='expenses',
                    to='sales_channels.saleschannel',
                )),
                ('created_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='expenses_created',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': 'pos_expense',
                'ordering': ['-occurred_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='expense',
            index=models.Index(fields=['sales_channel', 'occurred_at'], name='pos_expense_sales_c_ed7a85_idx'),
        ),
        migrations.AddIndex(
            model_name='expense',
            index=models.Index(fields=['company', 'occurred_at'], name='pos_expense_company_3df88b_idx'),
        ),
        migrations.AddConstraint(
            model_name='expense',
            constraint=models.CheckConstraint(
                check=models.Q(amount__gt=Decimal('0')),
                name='expense_amount_gt_zero',
            ),
        ),
    ]

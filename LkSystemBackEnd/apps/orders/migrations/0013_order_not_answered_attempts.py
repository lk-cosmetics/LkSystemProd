from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0012_workflow_status_and_loyalty'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='not_answered_attempts',
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text='Number of unanswered client call attempts for this order.',
            ),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('promotions', '0003_alter_promotionchannelrule_discount_value'),
    ]

    operations = [
        migrations.AlterField(
            model_name='promotion',
            name='end_date',
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text='When the promotion expires. Leave empty to run indefinitely until manually deactivated.',
                verbose_name='End Date',
            ),
        ),
    ]

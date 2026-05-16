from django.db import migrations, models


class Migration(migrations.Migration):

	dependencies = [
		('clients', '0002_client_brand_client_is_blocked_and_more'),
	]

	operations = [
		migrations.AlterUniqueTogether(
			name='client',
			unique_together=set(),
		),
		migrations.RemoveField(
			model_name='client',
			name='company',
		),
		migrations.AlterField(
			model_name='client',
			name='phone',
			field=models.CharField(
				blank=True,
				db_index=True,
				default=None,
				max_length=30,
				null=True,
				unique=True,
			),
		),
	]

"""
Add the active-brand workspace pointer to User.

``current_brand`` is the sub-workspace a user is currently focused on inside
their ``current_company``. NULL means "whole company" (no brand focus). It is
only ever set through the validated workspace-switch endpoint, and when set it
narrows data scoping to that brand.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('brands', '0001_initial'),
        ('users', '0004_invitation'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='current_brand',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to='brands.brand',
                help_text='Active brand workspace; must belong to current_company.',
                verbose_name='Active Brand',
            ),
        ),
    ]

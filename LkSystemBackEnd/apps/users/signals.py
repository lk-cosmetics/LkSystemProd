"""
LkSystem Users App - Signals
Auto-create Profile when User is created.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model

from .models import Profile

User = get_user_model()


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """
    Auto-create Profile when a new User is created.
    Ensures every User always has a linked Profile.
    """
    if created:
        # Only create if profile doesn't exist
        Profile.objects.get_or_create(user=instance)


@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """
    Save the Profile when User is saved.
    Creates profile if it doesn't exist.
    """
    try:
        instance.profile.save()
    except Profile.DoesNotExist:
        Profile.objects.create(user=instance)

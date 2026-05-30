"""
LkSystem Notifications App - Serializers

The list serializer flattens one ``NotificationRecipient`` (the per-user inbox
row) together with its parent ``Notification`` payload. The viewset fetches the
parent with ``select_related`` so this never triggers an N+1.
"""

from rest_framework import serializers

from apps.notifications.models import NotificationRecipient


class NotificationListSerializer(serializers.ModelSerializer):
    """One inbox item for the current user."""

    # ``id`` is the recipient (inbox) row id — the handle used by mark-read.
    # ``notification_id`` is read implicitly from the FK accessor of the same
    # name; specifying source='notification_id' would be redundant and DRF
    # rejects it, so we leave the source implicit.
    notification_id = serializers.IntegerField(read_only=True)
    title       = serializers.CharField(source='notification.title', read_only=True)
    body        = serializers.CharField(source='notification.body', read_only=True)
    link_url    = serializers.CharField(source='notification.link_url', read_only=True)
    entity_type = serializers.CharField(source='notification.entity_type', read_only=True)
    entity_id   = serializers.CharField(source='notification.entity_id', read_only=True)
    metadata    = serializers.JSONField(source='notification.metadata', read_only=True)

    class Meta:
        model = NotificationRecipient
        fields = [
            'id', 'notification_id', 'category', 'priority',
            'title', 'body', 'link_url', 'entity_type', 'entity_id', 'metadata',
            'is_read', 'read_at', 'created_at',
        ]
        read_only_fields = fields


class UnreadCountSerializer(serializers.Serializer):
    """Response shape for the unread-count endpoint."""
    unread = serializers.IntegerField()

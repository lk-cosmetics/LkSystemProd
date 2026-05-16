from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .consumers import SalesChannelConsumer


def broadcast_channel_event(event_type: str, channel_id: int):
    """
    Send a WebSocket broadcast to all connected clients.

    Args:
        event_type: One of 'created', 'updated', 'deleted'
        channel_id: The ID of the affected sales channel
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    async_to_sync(channel_layer.group_send)(
        SalesChannelConsumer.GROUP_NAME,
        {
            'type': 'sales_channel_updated',
            'payload': {
                'event': event_type,
                'channel_id': channel_id,
            },
        },
    )

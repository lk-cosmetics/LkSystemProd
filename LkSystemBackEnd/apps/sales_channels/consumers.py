from channels.generic.websocket import AsyncJsonWebsocketConsumer


class SalesChannelConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for real-time sales channel updates.
    Clients join the 'sales_channels' group and receive broadcast
    messages whenever a channel is created, updated, or deleted.
    """

    GROUP_NAME = 'sales_channels'

    async def connect(self):
        await self.channel_layer.group_add(self.GROUP_NAME, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.GROUP_NAME, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Client-to-server messages are not needed; ignore.
        pass

    # ---- broadcast handlers ------------------------------------------------

    async def sales_channel_updated(self, event):
        """Broadcast when a channel is created/updated/deleted."""
        await self.send_json(event['payload'])

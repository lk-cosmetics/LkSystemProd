from channels.generic.websocket import AsyncJsonWebsocketConsumer


class InventoryConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for real-time inventory updates.
    Clients join the 'inventory_updates' group and receive broadcast
    messages whenever inventory levels change.
    """

    GROUP_NAME = 'inventory_updates'

    async def connect(self):
        await self.channel_layer.group_add(self.GROUP_NAME, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.GROUP_NAME, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Client-to-server messages are not required.
        pass

    async def inventory_updated(self, event):
        """Broadcast when inventory is created/updated/deleted."""
        await self.send_json(event['payload'])

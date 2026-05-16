"""
LkSystem Inventory App - Serializers
REST API serializers for inventory management.
"""

from rest_framework import serializers
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import (
    BillOfMaterials,
    BillOfMaterialsItem,
    InventoryMovement,
    ProductionBatch,
    ProductionBatchComponent,
    SalesChannelInventory,
)
from apps.inventory.production_service import ProductionService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


# =============================================================================
# SALES CHANNEL INVENTORY SERIALIZERS
# =============================================================================

class SalesChannelInventoryListSerializer(serializers.ModelSerializer):
    """Serializer for listing sales channel inventories."""
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    sales_channel_code = serializers.CharField(source='sales_channel.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    product_image = serializers.URLField(source='product.image_url', read_only=True)
    company_id = serializers.IntegerField(source='sales_channel.brand.company_id', read_only=True)
    company_name = serializers.CharField(source='sales_channel.brand.company.name', read_only=True)
    available_quantity = serializers.IntegerField(read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)
    is_out_of_stock = serializers.BooleanField(read_only=True)
    
    class Meta:
        model = SalesChannelInventory
        fields = [
            'id', 'sales_channel', 'sales_channel_name', 'sales_channel_code',
            'product', 'product_name', 'product_barcode', 'product_image',
            'company_id', 'company_name',
            'quantity', 'reserved_quantity', 'available_quantity',
            'minimum_quantity', 'maximum_quantity', 'bin_location',
            'is_low_stock', 'is_out_of_stock',
            'last_counted_at', 'created_at', 'updated_at'
        ]


class SalesChannelInventoryDetailSerializer(SalesChannelInventoryListSerializer):
    """Detailed serializer for single channel inventory."""
    recent_movements = serializers.SerializerMethodField()
    
    class Meta(SalesChannelInventoryListSerializer.Meta):
        fields = SalesChannelInventoryListSerializer.Meta.fields + ['recent_movements']
    
    def get_recent_movements(self, obj):
        """Get recent inventory movements for this channel/product."""
        movements = InventoryMovement.objects.filter(
            sales_channel=obj.sales_channel,
            product=obj.product,
            status=InventoryMovement.MovementStatus.COMPLETED
        ).order_by('-created_at')[:10]
        return InventoryMovementListSerializer(movements, many=True, context=self.context).data


class SalesChannelInventoryCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating channel inventory."""
    
    class Meta:
        model = SalesChannelInventory
        fields = [
            'sales_channel', 'product', 'quantity', 'reserved_quantity',
            'minimum_quantity', 'maximum_quantity', 'bin_location'
        ]
    
    def validate(self, attrs):
        """Validate channel belongs to the same brand as the product."""
        sales_channel = attrs.get('sales_channel')
        product = attrs.get('product')

        if sales_channel and product and product.brand_id:
            if sales_channel.brand_id != product.brand_id:
                raise serializers.ValidationError({
                    'sales_channel': 'Sales channel must belong to the same brand as the product.'
                })

        return attrs


class SalesChannelInventoryAdjustSerializer(serializers.Serializer):
    """Serializer for inventory adjustments (quick stock changes)."""
    quantity_change = serializers.IntegerField(
        help_text='Positive for add, negative for remove'
    )
    movement_type = serializers.ChoiceField(
        choices=[
            ('ADJUSTMENT_IN', 'Add Stock'),
            ('ADJUSTMENT_OUT', 'Remove Stock'),
        ],
        required=False
    )
    notes = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True
    )
    
    def validate(self, attrs):
        quantity_change = attrs.get('quantity_change', 0)
        
        # Auto-determine movement type if not provided
        if 'movement_type' not in attrs or not attrs['movement_type']:
            if quantity_change > 0:
                attrs['movement_type'] = 'ADJUSTMENT_IN'
            else:
                attrs['movement_type'] = 'ADJUSTMENT_OUT'
                attrs['quantity_change'] = abs(quantity_change)
        
        return attrs


# =============================================================================
# INVENTORY MOVEMENT SERIALIZERS
# =============================================================================

class InventoryMovementListSerializer(serializers.ModelSerializer):
    """Serializer for listing inventory movements."""
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    sales_channel_code = serializers.CharField(source='sales_channel.code', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    movement_type_display = serializers.CharField(source='get_movement_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    destination_channel_name = serializers.CharField(source='destination_channel.name', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    is_stock_in = serializers.BooleanField(read_only=True)
    is_stock_out = serializers.BooleanField(read_only=True)
    
    class Meta:
        model = InventoryMovement
        fields = [
            'id', 'reference_number', 'sales_channel', 'sales_channel_name', 'sales_channel_code',
            'product', 'product_name', 'product_barcode',
            'movement_type', 'movement_type_display', 'status', 'status_display',
            'quantity', 'quantity_before', 'quantity_after',
            'unit_cost', 'total_cost',
            'destination_channel', 'destination_channel_name',
            'external_reference', 'notes',
            'is_stock_in', 'is_stock_out',
            'created_by', 'created_by_name', 'created_at', 'completed_at'
        ]
    
    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return None


class InventoryMovementDetailSerializer(InventoryMovementListSerializer):
    """Detailed serializer for single movement."""
    related_movement_ref = serializers.CharField(
        source='related_movement.reference_number', 
        read_only=True
    )
    
    class Meta(InventoryMovementListSerializer.Meta):
        fields = InventoryMovementListSerializer.Meta.fields + ['related_movement_ref']


class InventoryMovementCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating inventory movements."""
    
    class Meta:
        model = InventoryMovement
        fields = [
            'sales_channel', 'product', 'movement_type', 'quantity',
            'unit_cost', 'destination_channel', 'external_reference', 'notes'
        ]
    
    def validate(self, attrs):
        movement_type = attrs.get('movement_type')
        destination_channel = attrs.get('destination_channel')
        sales_channel = attrs.get('sales_channel')
        product = attrs.get('product')
        quantity = attrs.get('quantity', 0)
        
        # Validate transfer requirements
        if movement_type == InventoryMovement.MovementType.TRANSFER_OUT:
            if not destination_channel:
                raise serializers.ValidationError({
                    'destination_channel': 'Destination channel is required for transfers.'
                })
            if destination_channel == sales_channel:
                raise serializers.ValidationError({
                    'destination_channel': 'Cannot transfer to the same channel.'
                })
        
        # Validate stock-out has enough quantity
        stock_out_types = [
            InventoryMovement.MovementType.SALE,
            InventoryMovement.MovementType.RETURN_OUT,
            InventoryMovement.MovementType.TRANSFER_OUT,
            InventoryMovement.MovementType.ADJUSTMENT_OUT,
            InventoryMovement.MovementType.DAMAGE,
        ]
        
        if movement_type in stock_out_types:
            try:
                store_inv = SalesChannelInventory.objects.get(
                    sales_channel=sales_channel,
                    product=product
                )
                if store_inv.available_quantity < quantity:
                    raise serializers.ValidationError({
                        'quantity': f'Insufficient stock. Available: {store_inv.available_quantity}'
                    })
            except SalesChannelInventory.DoesNotExist:
                raise serializers.ValidationError({
                    'product': 'Product has no inventory in this channel.'
                })
        
        return attrs
    
    def create(self, validated_data):
        sales_channel = validated_data['sales_channel']
        product = validated_data['product']
        
        # Get current quantity
        try:
            store_inv = SalesChannelInventory.objects.get(
                sales_channel=sales_channel,
                product=product
            )
            quantity_before = store_inv.quantity
        except SalesChannelInventory.DoesNotExist:
            quantity_before = 0
        
        # Calculate quantity_after
        movement_type = validated_data['movement_type']
        quantity = validated_data['quantity']
        
        stock_in_types = [
            InventoryMovement.MovementType.PURCHASE,
            InventoryMovement.MovementType.RETURN_IN,
            InventoryMovement.MovementType.TRANSFER_IN,
            InventoryMovement.MovementType.ADJUSTMENT_IN,
            InventoryMovement.MovementType.INITIAL,
        ]
        
        if movement_type in stock_in_types:
            quantity_after = quantity_before + quantity
        else:
            quantity_after = quantity_before - quantity
        
        validated_data['quantity_before'] = quantity_before
        validated_data['quantity_after'] = quantity_after
        validated_data['created_by'] = self.context['request'].user
        
        return super().create(validated_data)


class InventoryMovementCompleteSerializer(serializers.Serializer):
    """Serializer for completing a movement."""
    notes = serializers.CharField(required=False, allow_blank=True)
    
    def update(self, instance, validated_data):
        if instance.status == InventoryMovement.MovementStatus.COMPLETED:
            raise serializers.ValidationError('Movement is already completed.')
        
        if instance.status == InventoryMovement.MovementStatus.CANCELLED:
            raise serializers.ValidationError('Cannot complete a cancelled movement.')
        
        instance.status = InventoryMovement.MovementStatus.COMPLETED
        if validated_data.get('notes'):
            instance.notes = f"{instance.notes}\n{validated_data['notes']}".strip()
        instance.save()
        
        return instance


class TransferCreateSerializer(serializers.Serializer):
    """Simplified serializer for creating inter-channel transfers."""
    source_channel = serializers.PrimaryKeyRelatedField(queryset=SalesChannel.objects.all())
    destination_channel = serializers.PrimaryKeyRelatedField(queryset=SalesChannel.objects.all())
    product = serializers.PrimaryKeyRelatedField(
        queryset=__import__('apps.products.models', fromlist=['Product']).Product.objects.all()
    )
    quantity = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=500)
    
    def validate(self, attrs):
        source = attrs['source_channel']
        destination = attrs['destination_channel']
        product = attrs['product']
        quantity = attrs['quantity']
        
        if source == destination:
            raise serializers.ValidationError({
                'destination_channel': 'Cannot transfer to the same channel.'
            })
        
        if source.brand.company_id != destination.brand.company_id:
            raise serializers.ValidationError({
                'destination_channel': 'Both channels must belong to the same company.'
            })
        
        # Check available stock
        try:
            store_inv = SalesChannelInventory.objects.get(
                sales_channel=source,
                product=product
            )
            if store_inv.available_quantity < quantity:
                raise serializers.ValidationError({
                    'quantity': f'Insufficient stock. Available: {store_inv.available_quantity}'
                })
        except SalesChannelInventory.DoesNotExist:
            raise serializers.ValidationError({
                'product': 'Product has no inventory in source channel.'
            })
        
        return attrs
    
    def create(self, validated_data):
        source = validated_data['source_channel']
        destination = validated_data['destination_channel']
        product = validated_data['product']
        quantity = validated_data['quantity']
        notes = validated_data.get('notes', '')
        user = self.context['request'].user
        
        # Get current quantities
        source_inv = SalesChannelInventory.objects.get(
            sales_channel=source,
            product=product
        )
        
        try:
            dest_inv = SalesChannelInventory.objects.get(
                sales_channel=destination,
                product=product
            )
            dest_quantity = dest_inv.quantity
        except SalesChannelInventory.DoesNotExist:
            dest_quantity = 0
        
        with transaction.atomic():
            # Create transfer-out movement
            transfer_out = InventoryMovement.objects.create(
                sales_channel=source,
                product=product,
                movement_type=InventoryMovement.MovementType.TRANSFER_OUT,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=quantity,
                quantity_before=source_inv.quantity,
                quantity_after=source_inv.quantity - quantity,
                destination_channel=destination,
                notes=f"Transfer to {destination.name}. {notes}".strip(),
                created_by=user,
                completed_at=timezone.now(),
            )
        
        return transfer_out


# =============================================================================
# PRODUCT INVENTORY SUMMARY SERIALIZER
# =============================================================================

class ProductInventorySummarySerializer(serializers.Serializer):
    """Serializer for product inventory summary across all channels."""
    product_id = serializers.IntegerField()
    product_name = serializers.CharField()
    product_barcode = serializers.CharField()
    total_quantity = serializers.IntegerField()
    total_reserved = serializers.IntegerField()
    total_available = serializers.IntegerField()
    channels_count = serializers.IntegerField()
    channel_breakdown = SalesChannelInventoryListSerializer(many=True)


# =============================================================================
# BOM / PRODUCTION SERIALIZERS
# =============================================================================

class BillOfMaterialsItemSerializer(serializers.ModelSerializer):
    component_name = serializers.CharField(source='component.name', read_only=True)
    component_barcode = serializers.CharField(source='component.barcode', read_only=True)

    class Meta:
        model = BillOfMaterialsItem
        fields = [
            'id', 'component', 'component_name', 'component_barcode',
            'quantity_per_unit', 'waste_percent', 'notes',
        ]

    def validate(self, attrs):
        bom = self.context.get('bom') or getattr(self.instance, 'bom', None)
        component = attrs.get('component') or getattr(self.instance, 'component', None)
        if bom and component:
            if component.id == bom.finished_product_id:
                raise serializers.ValidationError({
                    'component': 'A product cannot be a component of itself.'
                })
            if bom.company and component.company and bom.company.id != component.company.id:
                raise serializers.ValidationError({
                    'component': 'Component must belong to the same company as the finished product.'
                })
        return attrs


class BillOfMaterialsListSerializer(serializers.ModelSerializer):
    finished_product_name = serializers.CharField(source='finished_product.name', read_only=True)
    finished_product_barcode = serializers.CharField(source='finished_product.barcode', read_only=True)
    company_id = serializers.IntegerField(source='finished_product.brand.company_id', read_only=True)
    items_count = serializers.IntegerField(source='items.count', read_only=True)

    class Meta:
        model = BillOfMaterials
        fields = [
            'id', 'finished_product', 'finished_product_name', 'finished_product_barcode',
            'company_id', 'name', 'version', 'is_active', 'items_count',
            'notes', 'created_by', 'created_at', 'updated_at',
        ]


class BillOfMaterialsDetailSerializer(BillOfMaterialsListSerializer):
    items = BillOfMaterialsItemSerializer(many=True)

    class Meta(BillOfMaterialsListSerializer.Meta):
        fields = BillOfMaterialsListSerializer.Meta.fields + ['items']

    def validate(self, attrs):
        finished_product = attrs.get('finished_product') or getattr(self.instance, 'finished_product', None)
        if finished_product and finished_product.is_pack:
            raise serializers.ValidationError({
                'finished_product': 'Pack products cannot also use a manufacturing BOM.'
            })
        return attrs

    def _save_items(self, bom, items_data):
        seen = set()
        for item in items_data:
            component = item['component']
            if component.id in seen:
                raise serializers.ValidationError({
                    'items': f'Duplicate component {component.id} in BOM.'
                })
            seen.add(component.id)
            item_serializer = BillOfMaterialsItemSerializer(
                context={**self.context, 'bom': bom},
            )
            item_serializer.validate(item)
            BillOfMaterialsItem.objects.create(bom=bom, **item)

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        if not items_data:
            raise serializers.ValidationError({'items': 'A BOM must have at least one component.'})
        validated_data['created_by'] = self.context['request'].user
        with transaction.atomic():
            bom = BillOfMaterials.objects.create(**validated_data)
            self._save_items(bom, items_data)
        return bom

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()
            if items_data is not None:
                instance.items.all().delete()
                self._save_items(instance, items_data)
        return instance


class ProductionBatchComponentSerializer(serializers.ModelSerializer):
    component_name = serializers.CharField(source='component.name', read_only=True)
    component_barcode = serializers.CharField(source='component.barcode', read_only=True)
    in_factory_quantity = serializers.IntegerField(read_only=True)
    sent_movement_reference = serializers.CharField(source='sent_movement.reference_number', read_only=True)

    class Meta:
        model = ProductionBatchComponent
        fields = [
            'id', 'component', 'component_name', 'component_barcode',
            'quantity_sent', 'quantity_consumed', 'in_factory_quantity',
            'sent_movement', 'sent_movement_reference',
        ]


class ProductionBatchListSerializer(serializers.ModelSerializer):
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    finished_product_name = serializers.CharField(source='finished_product.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    company_id = serializers.IntegerField(source='sales_channel.brand.company_id', read_only=True)
    in_factory_quantity = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProductionBatch
        fields = [
            'id', 'batch_number', 'sales_channel', 'sales_channel_name',
            'finished_product', 'finished_product_name', 'bom',
            'company_id', 'status', 'status_display',
            'planned_quantity', 'received_quantity', 'in_factory_quantity',
            'sent_at', 'completed_at', 'notes', 'created_by', 'created_at', 'updated_at',
        ]


class ProductionBatchDetailSerializer(ProductionBatchListSerializer):
    components = ProductionBatchComponentSerializer(many=True, read_only=True)

    class Meta(ProductionBatchListSerializer.Meta):
        fields = ProductionBatchListSerializer.Meta.fields + ['components']


class ProductionBatchSendSerializer(serializers.Serializer):
    sales_channel = serializers.PrimaryKeyRelatedField(queryset=SalesChannel.objects.all())
    finished_product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    planned_quantity = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def create(self, validated_data):
        return ProductionService.send_to_factory(
            sales_channel=validated_data['sales_channel'],
            finished_product=validated_data['finished_product'],
            planned_quantity=validated_data['planned_quantity'],
            created_by=self.context['request'].user,
            notes=validated_data.get('notes', ''),
        )


class ProductionBatchReceiveSerializer(serializers.Serializer):
    REASONS = [
        ('PRODUCTION_RETURNED', 'Production order returned from factory'),
        ('LAB_RECEIVED', 'Received from laboratory'),
        ('PARTIAL_PRODUCTION_RETURNED', 'Partial production returned'),
        ('OTHER', 'Other'),
    ]

    received_quantity = serializers.IntegerField(min_value=1)
    reason = serializers.ChoiceField(choices=REASONS, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def save(self, **kwargs):
        batch = self.context['batch']
        reason_map = dict(self.REASONS)
        reason = reason_map.get(
            self.validated_data.get('reason'),
            'Production order returned from factory',
        )
        return ProductionService.receive_from_factory(
            batch=batch,
            received_quantity=self.validated_data['received_quantity'],
            created_by=self.context['request'].user,
            reason=reason,
            notes=self.validated_data.get('notes', ''),
        )


class ProductionBatchUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductionBatch
        fields = ['notes']

    def update(self, instance, validated_data):
        if instance.status == ProductionBatch.Status.CANCELLED:
            raise serializers.ValidationError({'batch': 'Cancelled production orders cannot be edited.'})
        return super().update(instance, validated_data)


class ProductionBatchCancelSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def save(self, **kwargs):
        return ProductionService.cancel_order(
            batch=self.context['batch'],
            created_by=self.context['request'].user,
            notes=self.validated_data.get('notes', ''),
        )

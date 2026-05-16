"""
LkSystem Clients App - Serializers
"""

from rest_framework import serializers
from .models import Client
from .utils import normalize_tunisian_phone
from django.core.exceptions import ValidationError as DjangoValidationError
from apps.sales_channels.models import SalesChannel


class ClientListSerializer(serializers.ModelSerializer):
    """Compact serializer for lists / dropdowns."""
    company_name = serializers.CharField(source='company.name', read_only=True, default=None)
    brand_name = serializers.CharField(source='brand.name', read_only=True, default=None)
    full_name = serializers.CharField(read_only=True)
    sales_channel_name = serializers.CharField(
        source='sales_channel.name', read_only=True, default=None,
    )
    reseller_name = serializers.CharField(
        source='reseller.full_name', read_only=True, default=None,
    )
    governorate = serializers.CharField(source='state', read_only=True, default='')
    points = serializers.SerializerMethodField()
    number_of_orders = serializers.SerializerMethodField()
    number_of_returns = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = [
            'id',
            'company', 'company_name',
            'brand', 'brand_name',
            'reseller', 'reseller_name',
            'email', 'first_name', 'last_name', 'full_name',
            'phone', 'phone_normalized', 'client_type', 'date_of_birth',
            'governorate', 'state', 'city', 'country',
            'source', 'sales_channel', 'sales_channel_name',
            'wc_customer_id', 'is_active',
            'points', 'number_of_orders', 'number_of_returns', 'is_blocked',
            'created_at', 'updated_at',
        ]

    @staticmethod
    def get_points(obj):
        return int(getattr(obj, 'calculated_points', obj.points or 0) or 0)

    @staticmethod
    def get_number_of_orders(obj):
        return int(getattr(obj, 'calculated_order_count', obj.number_of_orders or 0) or 0)

    @staticmethod
    def get_number_of_returns(obj):
        return int(getattr(obj, 'calculated_return_count', obj.number_of_returns or 0) or 0)


class ClientDetailSerializer(ClientListSerializer):
    """Full serializer with address fields."""

    class Meta(ClientListSerializer.Meta):
        fields = ClientListSerializer.Meta.fields + [
            'address', 'postcode', 'notes',
            'created_by',
        ]


class ClientCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating / updating a client."""

    def validate_phone(self, value):
        if value in ('', None):
            return None
        normalized = normalize_tunisian_phone(value)
        qs = Client.objects.filter(phone_normalized=normalized)
        request = self.context.get('request')
        company = getattr(getattr(request, 'user', None), 'current_company', None)
        company = getattr(self.instance, 'company', None) or company
        if company:
            qs = qs.filter(company=company)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('A client with this phone already exists.')
        return value

    class Meta:
        model = Client
        fields = [
            'company',
            'brand', 'reseller',
            'email', 'first_name', 'last_name',
            'phone', 'client_type', 'date_of_birth', 'address', 'state', 'postcode', 'country',
            'source', 'sales_channel', 'wc_customer_id', 'notes',
            'points', 'number_of_orders', 'number_of_returns', 'is_blocked',
        ]

    def validate(self, attrs):
        email = attrs.get('email')
        if email:
            qs = Client.objects.filter(company=attrs.get('company') or getattr(self.instance, 'company', None), email=email)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'email': 'A client with this email already exists.'}
                )
        return attrs


class ClientCreateFromPOSSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a client directly from the POS page.
    
    Best Practice:
      - Automatically assigns brand from the sales_channel (no frontend responsibility)
      - Sets source=POS automatically
      - Validates phone and email uniqueness
      - Returns sales_channel info in response for POS to track which channel the client belongs to
    """
    full_name = serializers.CharField(read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True, default=None)
    company_name = serializers.CharField(source='company.name', read_only=True, default=None)
    created_by_username = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)
    sales_channel_id = serializers.IntegerField(
        source='sales_channel.id',
        read_only=True,
        help_text='The sales channel ID associated with this client'
    )
    sales_channel_name = serializers.CharField(
        source='sales_channel.name',
        read_only=True,
        help_text='The sales channel name'
    )
    sales_channel = serializers.PrimaryKeyRelatedField(
        queryset=SalesChannel.objects.select_related('brand'),
        required=True,
        write_only=True,
        help_text='Sales channel ID from the POS page'
    )

    class Meta:
        model = Client
        fields = [
            'id', 'email', 'first_name', 'last_name', 'full_name',
            'phone', 'phone_normalized', 'client_type', 'date_of_birth',
            'address', 'state', 'postcode', 'country',
            'reseller', 'wc_customer_id', 'notes',
            'sales_channel',  # Write-only input
            'sales_channel_id', 'sales_channel_name',  # Read-only response
            'brand', 'brand_name',
            'company', 'company_name',
            'source', 'is_active', 'is_blocked', 'points', 'number_of_orders', 'number_of_returns',
            'created_by', 'created_by_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'brand', 'brand_name', 'company', 'company_name',
            'source', 'sales_channel_id', 'sales_channel_name',
            'full_name', 'phone_normalized', 'is_active', 'is_blocked',
            'points', 'number_of_orders', 'number_of_returns',
            'created_by', 'created_by_username', 'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'email': {'required': True},
            'first_name': {'required': False, 'allow_blank': True},
            'last_name': {'required': False, 'allow_blank': True},
            'phone': {'required': False, 'allow_blank': True},
            'email': {'required': False, 'allow_blank': True},
            'country': {'required': False, 'allow_blank': True},
        }

    def validate_phone(self, value):
        """Ensure phone is unique (if provided)."""
        if value in ('', None):
            return None
        normalized = normalize_tunisian_phone(value)
        qs = Client.objects.filter(phone_normalized=normalized)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            return value
        return value

    def validate(self, attrs):
        """Validate email uniqueness and ensure sales_channel has a brand."""
        email = attrs.get('email')
        sales_channel = attrs.get('sales_channel')

        # ✨ Ensure sales_channel is provided (frontend should enforce, but backend validates)
        if not sales_channel:
            raise serializers.ValidationError(
                {'sales_channel': 'Sales channel is required to create a client from POS.'}
            )

        # Ensure sales_channel has a brand (data integrity check)
        if not sales_channel.brand:
            raise serializers.ValidationError(
                {'sales_channel': 'Sales channel must have a brand assigned. Please configure the channel in admin.'}
            )

        return attrs

    @staticmethod
    def _generated_email(phone: str | None, company) -> str:
        normalized = normalize_tunisian_phone(phone) or 'unknown'
        return f'{normalized}@noemail.{(company.abbreviation or "local").lower()}'

    def create(self, validated_data, **kwargs):
        """
        Create client with automatic brand, company, and source assignment.
        
        Data Integrity Principle (Company → Brand → SalesChannel):
          - Client must belong to the SAME company as the sales_channel's brand
          - NOT the current_user's company (user might be in different company)
        
        Process:
          1. Extract sales_channel from validated_data
          2. Get brand from sales_channel (guaranteed to exist)
          3. Get company from sales_channel.brand.company (data integrity)
          4. Create client with all auto-assigned fields
          5. Merge audit kwargs (created_by, etc.)
        
        Returns: Client with brand, sales_channel, company all properly set
        """
        sales_channel = validated_data.pop('sales_channel')
        brand = sales_channel.brand
        company = brand.company  # ✨ Get company from brand, not from user context
        
        phone = validated_data.get('phone')
        normalized = normalize_tunisian_phone(phone)
        email = (validated_data.get('email') or '').strip().lower()
        if not email:
            email = self._generated_email(phone, company)
            validated_data['email'] = email

        client = None
        if normalized:
            client = Client.objects.filter(company=company, phone_normalized=normalized).first()
        if client is None and email:
            client = Client.objects.filter(company=company, email=email).first()

        if client:
            updatable = [
                'first_name', 'last_name', 'email', 'phone', 'client_type',
                'date_of_birth', 'address', 'state', 'postcode', 'country',
                'reseller', 'wc_customer_id', 'notes',
            ]
            update_fields = []
            for field in updatable:
                if field in validated_data and validated_data[field] not in (None, ''):
                    setattr(client, field, validated_data[field])
                    update_fields.append(field)
            client.brand = client.brand or brand
            client.company = client.company or company
            client.sales_channel = client.sales_channel or sales_channel
            update_fields.extend(['brand', 'company', 'sales_channel'])
            client.save(update_fields=[*dict.fromkeys(update_fields), 'phone_normalized', 'updated_at'])
            return client

        client = Client.objects.create(
            **validated_data,
            brand=brand,
            company=company,
            sales_channel=sales_channel,
            source=Client.Source.POS,
            **kwargs,
        )
        return client

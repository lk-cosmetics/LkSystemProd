"""
LkSystem RBAC — API Serializers.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from ..models import AppPermission, Role, UserRole

User = get_user_model()


# ── Permission ──────────────────────────────────────────────────────────

class AppPermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppPermission
        fields = ['id', 'codename', 'name', 'category', 'description']
        read_only_fields = ['id']


class PermissionByCategorySerializer(serializers.Serializer):
    """Groups permissions by category for the UI."""
    category = serializers.CharField()
    permissions = AppPermissionSerializer(many=True)


# ── Role ────────────────────────────────────────────────────────────────

class RoleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    permissions_count = serializers.IntegerField(
        source='permissions.count', read_only=True
    )
    assignments_count = serializers.IntegerField(
        source='assignments.count', read_only=True
    )
    company_name = serializers.CharField(
        source='company.name', read_only=True, default=None
    )
    # Operational roles (Employee / Cashier) must be assigned a sales point;
    # the Add-User / Invite forms use this flag to require the channel selector.
    requires_sales_point = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'description', 'scope_type',
            'company', 'company_name',
            'is_system', 'permissions_count', 'assignments_count',
            'requires_sales_point',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'is_system', 'created_at', 'updated_at']

    def get_requires_sales_point(self, obj) -> bool:
        from apps.rbac.services import role_requires_sales_point
        return role_requires_sales_point(obj)


class RoleDetailSerializer(serializers.ModelSerializer):
    """Full detail with permission codenames."""
    permissions = serializers.SlugRelatedField(
        many=True,
        slug_field='codename',
        queryset=AppPermission.objects.all(),
    )
    # Page-access denylist (navigation only — independent of permissions).
    hidden_pages = serializers.ListField(
        child=serializers.CharField(), required=False,
    )
    company_name = serializers.CharField(
        source='company.name', read_only=True, default=None
    )

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'description', 'scope_type',
            'company', 'company_name',
            'permissions', 'hidden_pages', 'is_system',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'is_system', 'created_at', 'updated_at']

    def validate_hidden_pages(self, value):
        """Only accept real page keys, de-duplicated."""
        from apps.rbac.constants import get_page_definitions
        valid = {p['key'] for p in get_page_definitions()}
        return sorted({k for k in value if k in valid})

    def validate_name(self, value):
        # Prevent renaming system roles
        if self.instance and self.instance.is_system:
            if self.instance.name != value:
                raise serializers.ValidationError(
                    'System roles cannot be renamed.'
                )
        return value

    def create(self, validated_data):
        permissions = validated_data.pop('permissions', [])
        role = Role.objects.create(**validated_data)
        role.permissions.set(permissions)
        return role

    def update(self, instance, validated_data):
        permissions = validated_data.pop('permissions', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if permissions is not None:
            instance.permissions.set(permissions)
        return instance


# ── User Role Assignment ────────────────────────────────────────────────

class UserRoleAssignmentSerializer(serializers.ModelSerializer):
    """Read representation of a user-role assignment."""
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_scope_type = serializers.CharField(
        source='role.scope_type', read_only=True
    )
    scope = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = UserRole
        fields = [
            'id', 'user', 'role', 'role_name', 'role_scope_type',
            'company', 'brand', 'sales_channel',
            'scope',
            'permissions',
            'assigned_by', 'assigned_at',
        ]
        read_only_fields = [
            'id', 'role_name', 'role_scope_type',
            'scope', 'permissions', 'assigned_by', 'assigned_at',
        ]

    def get_scope(self, obj):
        return obj.scope_display

    def get_permissions(self, obj):
        return obj.role.get_permission_codenames()


class AssignRoleSerializer(serializers.Serializer):
    """Input serializer for assigning a role to a user."""
    user_id = serializers.IntegerField()
    role_id = serializers.IntegerField()
    company_id = serializers.IntegerField(required=False, allow_null=True)
    brand_id = serializers.IntegerField(required=False, allow_null=True)
    sales_channel_id = serializers.IntegerField(
        required=False, allow_null=True
    )

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError('User not found.')
        return value

    def validate_role_id(self, value):
        if not Role.objects.filter(id=value).exists():
            raise serializers.ValidationError('Role not found.')
        return value

    def validate(self, data):
        # Exactly one scope FK should be set (or none for platform)
        scope_fields = ['company_id', 'brand_id', 'sales_channel_id']
        set_fields = [f for f in scope_fields if data.get(f)]
        if len(set_fields) > 1:
            raise serializers.ValidationError(
                'Provide at most one scope: company_id, brand_id, '
                'or sales_channel_id.'
            )
        return data


class RevokeRoleSerializer(serializers.Serializer):
    """Input serializer for revoking a user-role assignment."""
    assignment_id = serializers.IntegerField()

    def validate_assignment_id(self, value):
        if not UserRole.objects.filter(id=value).exists():
            raise serializers.ValidationError('Assignment not found.')
        return value


# ── Compact representation for JWT / login response ─────────────────────

class UserPermissionsSummarySerializer(serializers.Serializer):
    """Flat summary injected into the login response & JWT."""
    roles = serializers.ListField(child=serializers.CharField())
    permissions = serializers.ListField(child=serializers.CharField())
    scope_assignments = UserRoleAssignmentSerializer(many=True)

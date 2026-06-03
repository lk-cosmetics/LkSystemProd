"""
LkSystem Users App - API Serializers
JWT authentication with smart brand switching logic.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from ..models import Profile, PasswordResetToken, Invitation
from apps.rbac.models import Role

User = get_user_model()


# =============================================================================
# JWT AUTHENTICATION SERIALIZERS
# =============================================================================

class LkSystemTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT Token serializer that injects user context into the token.
    
    Token payload includes:
    - matricule: User's unique identifier
    - role: Role name
    - company_id: Current company ID
    - allowed_brand_ids: List of brand IDs based on can_switch_brands permission
    """
    
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # ── Identity ──
        token['matricule'] = user.matricule
        token['email'] = user.email
        token['full_name'] = user.get_full_name()
        # Capability flag (not a role-name): true only for Django superusers,
        # i.e. the platform owner. The frontend uses it as the single root
        # bypass; every other capability is resolved from `permissions`.
        token['is_superuser'] = user.is_superuser

        # ── RBAC: dynamic roles & permissions ──
        from apps.rbac.services import PermissionService

        rbac_perms = sorted(PermissionService.get_user_permissions(user))
        token['roles'] = PermissionService.get_user_role_names(user)
        token['permissions'] = rbac_perms

        token['can_switch_brands'] = 'switch_brands' in rbac_perms

        # ── Company ──
        if user.current_company:
            token['company_id'] = user.current_company.id
            token['company_name'] = user.current_company.name
            token['company_abbreviation'] = user.current_company.abbreviation
        else:
            token['company_id'] = None
            token['company_name'] = None
            token['company_abbreviation'] = None

        # ── Brand access ──
        token['allowed_brand_ids'] = user.get_allowed_brand_ids()
        default_brand = user.get_default_brand()
        token['default_brand_id'] = (
            default_brand.id if default_brand else None
        )
        token['default_brand_name'] = (
            default_brand.name if default_brand else None
        )

        return token
    
    def validate(self, attrs):
        """Override to add extra response data including RBAC permissions.

        Also normalises the matricule the client sent — trims surrounding
        whitespace and forces uppercase so a copy-paste with a trailing
        space (the most common login-fail report we get) still resolves
        the right user.
        """
        username_field = self.username_field  # 'matricule' for this project
        raw = attrs.get(username_field)
        if isinstance(raw, str):
            attrs[username_field] = raw.strip().upper()

        data = super().validate(attrs)

        user = self.user

        # ── RBAC: resolve roles & permissions dynamically ──
        from apps.rbac.services import PermissionService

        rbac_roles = PermissionService.get_user_role_names(user)
        rbac_perms = sorted(PermissionService.get_user_permissions(user))

        can_switch = 'switch_brands' in rbac_perms

        data['user'] = {
            'id': user.id,
            'matricule': user.matricule,
            'email': user.email,
            'full_name': user.get_full_name(),
            'role': rbac_roles[0] if rbac_roles else None,
            'roles': rbac_roles,
            'permissions': rbac_perms,
            'is_superuser': user.is_superuser,
            'can_switch_brands': can_switch,
            'company_id': (
                user.current_company.id if user.current_company else None
            ),
            'company_name': (
                user.current_company.name if user.current_company else None
            ),
            'current_brand_id': user.current_brand_id,
            'allowed_brand_ids': user.get_allowed_brand_ids(),
        }

        return data


# =============================================================================
# PROFILE SERIALIZERS
# =============================================================================

class ProfileSerializer(serializers.ModelSerializer):
    """Serializer for Profile model."""
    
    completion_percentage = serializers.SerializerMethodField()
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    education_level_display = serializers.CharField(
        source='get_education_level_display', 
        read_only=True
    )
    
    class Meta:
        model = Profile
        fields = [
            'id',
            # Identity
            'cin_number',
            'cin_front',
            'cin_back',
            'passport_number',
            'passport_image',
            # Bio
            'birth_date',
            'gender',
            'gender_display',
            'nationality',
            'phone',
            'emergency_phone',
            'emergency_contact_name',
            'address',
            'city',
            'postal_code',
            'avatar',
            # Education
            'education_level',
            'education_level_display',
            'diploma_title',
            'diploma_file',
            'institution',
            'graduation_year',
            # Status
            'is_complete',
            'completion_percentage',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'is_complete', 'created_at', 'updated_at']
    
    def get_completion_percentage(self, obj):
        return obj.get_completion_percentage()


# =============================================================================
# USER SERIALIZERS
# =============================================================================

class UserListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for User list views."""

    role_name = serializers.SerializerMethodField()
    company_name = serializers.CharField(source='current_company.name', read_only=True)
    full_name = serializers.SerializerMethodField()
    # Avatar lives on the related ``Profile`` (one-to-one). Surface it at
    # the top level here so the UsersPage list + quick-view <Avatar>
    # components don't have to drill through ``profile.avatar`` — that
    # field never reached the list response before, which is why every
    # row was falling back to the initials placeholder.
    avatar = serializers.SerializerMethodField()
    allowed_brand_names = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'matricule',
            'email',
            'first_name',
            'last_name',
            'full_name',
            'role_name',
            'current_company',
            'company_name',
            'is_active',
            'date_joined',
            'avatar',
            'allowed_brand_names',
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()

    def get_role_name(self, obj):
        # Use the prefetched ``user_roles__role`` (see UserViewSet.get_queryset)
        # to avoid one query per row on the list endpoint.
        roles = list(obj.user_roles.all())
        return roles[0].role.name if roles else None

    def get_avatar(self, obj):
        """Return the profile avatar URL (absolute if the request is in
        context), or ``None`` when the user hasn't uploaded one. Robust to
        a missing Profile row — the M2M signal usually creates one, but
        legacy accounts may not have it."""
        profile = getattr(obj, 'profile', None)
        if profile is None or not profile.avatar:
            return None
        request = self.context.get('request')
        url = profile.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_allowed_brand_names(self, obj):
        # Use the prefetched ``allowed_brands`` (model instances) rather than
        # ``.values_list(...)``, which would issue a fresh query per row and
        # defeat the prefetch — the source of the user-list N+1.
        return [brand.name for brand in obj.allowed_brands.all()]


class UserDetailSerializer(serializers.ModelSerializer):
    """Detailed User serializer with profile and brands."""

    role_name = serializers.SerializerMethodField()
    company_name = serializers.CharField(source='current_company.name', read_only=True)
    full_name = serializers.SerializerMethodField()
    profile = ProfileSerializer(read_only=True)
    allowed_brand_ids = serializers.SerializerMethodField()
    allowed_brand_names = serializers.SerializerMethodField()
    can_switch_brands = serializers.SerializerMethodField()
    # Top-level mirror of profile.avatar — saves the frontend from
    # drilling through the nested profile object every time it wants to
    # render an <Avatar> in the quick-view dialog.
    avatar = serializers.SerializerMethodField()
    # Sales point an operational account (Employee / Cashier) is pinned to.
    assigned_sales_channel_name = serializers.CharField(
        source='assigned_sales_channel.name', read_only=True, default=None
    )

    class Meta:
        model = User
        fields = [
            'id',
            'matricule',
            'email',
            'first_name',
            'last_name',
            'full_name',
            'role_name',
            'current_company',
            'company_name',
            'allowed_brands',
            'allowed_brand_ids',
            'allowed_brand_names',
            'assigned_sales_channel',
            'assigned_sales_channel_name',
            'can_switch_brands',
            'is_active',
            'is_staff',
            'date_joined',
            'last_login',
            'profile',
            'avatar',
        ]
        read_only_fields = ['id', 'matricule', 'date_joined', 'last_login']

    def get_avatar(self, obj):
        profile = getattr(obj, 'profile', None)
        if profile is None or not profile.avatar:
            return None
        request = self.context.get('request')
        url = profile.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_allowed_brand_names(self, obj):
        return list(obj.allowed_brands.values_list('name', flat=True))

    def get_full_name(self, obj):
        return obj.get_full_name()

    def get_role_name(self, obj):
        from apps.rbac.services import PermissionService
        names = PermissionService.get_user_role_names(obj)
        return names[0] if names else None

    def get_allowed_brand_ids(self, obj):
        return obj.get_allowed_brand_ids()

    def get_can_switch_brands(self, obj):
        return obj.can_switch_brands()


class CreateEmployeeSerializer(serializers.ModelSerializer):
    """
    Serializer for creating new employees (User + Profile).
    Handles atomic creation with brand validation.
    """
    
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )
    
    # Profile fields (optional at creation)
    cin_number = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True)
    birth_date = serializers.DateField(required=False, allow_null=True)
    gender = serializers.ChoiceField(
        choices=Profile.Gender.choices,
        required=False,
        allow_null=True
    )

    # RBAC role to attach to this user. Without it, the freshly-created user
    # has zero permissions (no UserRole row) and every screen errors as
    # "Dashboard is unreachable" / "Failed to load roles" until an admin
    # remembers to assign a role through a second endpoint. Making this
    # part of the create payload closes that footgun.
    role_id = serializers.PrimaryKeyRelatedField(
        write_only=True,
        required=False,
        allow_null=True,
        queryset=Role.objects.all(),
        help_text=(
            'RBAC role to assign to the new user. Optional but strongly '
            'recommended — a user without a role has no permissions.'
        ),
    )

    class Meta:
        model = User
        fields = [
            'matricule',
            'email',
            'password',
            'password_confirm',
            'first_name',
            'last_name',
            'current_company',
            'allowed_brands',
            # Profile fields
            'cin_number',
            'phone',
            'birth_date',
            'gender',
            # RBAC
            'role_id',
        ]
        read_only_fields = ['matricule']  # Auto-generated on creation
        extra_kwargs = {
            'current_company': {'required': False},
            'allowed_brands': {'required': False},
        }
    
    def validate(self, attrs):
        """Validate passwords match, brands belong to company, and the
        chosen role is one the actor is actually allowed to grant."""
        # Password confirmation
        if attrs.get('password') != attrs.get('password_confirm'):
            raise serializers.ValidationError({
                'password_confirm': 'Passwords do not match.'
            })

        # RBAC isolation + privilege ceiling on the assigned role.
        role = attrs.get('role_id')
        request = self.context.get('request')
        actor = getattr(request, 'user', None) if request else None

        from apps.rbac.services import PermissionService

        # Gate the whole create endpoint behind ``create_users``. The viewset
        # only enforces IsAuthenticated, so without this any authenticated user
        # (even a Cashier) could create accounts. ``get_capability_permissions``
        # matches the permission anywhere within the actor's active company
        # (company-wide, brand or channel role), so a brand-scoped manager who
        # legitimately holds create_users passes correctly.
        if actor is not None and not actor.is_superuser:
            target_company = attrs.get('current_company') or getattr(actor, 'current_company', None)
            if 'create_users' not in PermissionService.get_capability_permissions(actor, company=target_company):
                raise serializers.ValidationError(
                    'You do not have permission to create users.'
                )

        if role is not None and actor is not None:
            from apps.rbac.provisioning import assert_within_ceiling

            if not PermissionService.is_platform_admin(actor):
                # A company-scoped actor may only grant a role owned by their
                # own company (never a platform role or another tenant's role
                # or a global template).
                actor_company_id = getattr(actor, 'current_company_id', None)
                if role.scope_type == 'platform':
                    raise serializers.ValidationError({
                        'role_id': 'You cannot assign a platform role.'
                    })
                if not actor_company_id:
                    raise serializers.ValidationError({
                        'role_id': 'You must belong to a company to assign roles.'
                    })
                # A company-owned role must match the actor's company; a global
                # default role (company IS NULL) may be assigned by any company.
                if role.company_id is not None and role.company_id != actor_company_id:
                    raise serializers.ValidationError({
                        'role_id': 'You can only assign roles that belong to '
                                   'your company.'
                    })
                # Cannot grant a role more powerful than the actor.
                assert_within_ceiling(
                    actor,
                    role.permissions.values_list('codename', flat=True),
                )

        return attrs
    
    def validate_allowed_brands(self, value):
        """
        CRITICAL VALIDATION: Ensure all brands belong to the user's company.
        Cannot assign Brand from Company B to User in Company A.
        """
        # Get company from initial data (not yet saved)
        company_id = self.initial_data.get('current_company')
        
        if not company_id:
            if value:
                raise serializers.ValidationError(
                    'Cannot assign brands without a company.'
                )
            return value
        
        # Import here to avoid circular imports
        from apps.brands.models import Brand
        
        # Validate each brand belongs to the company
        invalid_brands = []
        for brand in value:
            if brand.company_id != int(company_id):
                invalid_brands.append(brand.name)
        
        if invalid_brands:
            raise serializers.ValidationError(
                f"The following brands do not belong to the selected company: "
                f"{', '.join(invalid_brands)}"
            )
        
        return value
    
    def generate_matricule(self, company):
        """
        Generate a unique matricule based on company abbreviation.
        Format: ABBR-XXXX (e.g., COMP-0001)
        """
        if not company:
            # Fallback for users without company
            prefix = 'SYS'
        else:
            prefix = company.abbreviation
        
        # Find the next available number
        last_user = User.objects.filter(
            matricule__startswith=f"{prefix}-"
        ).order_by('-matricule').first()
        
        if last_user:
            try:
                last_number = int(last_user.matricule.split('-')[-1])
                next_number = last_number + 1
            except (ValueError, IndexError):
                next_number = 1
        else:
            next_number = 1
        
        return f"{prefix}-{next_number:04d}"
    
    @transaction.atomic
    def create(self, validated_data):
        """Create User + Profile + RBAC role assignment atomically."""
        # Extract profile fields
        profile_data = {
            'cin_number': validated_data.pop('cin_number', None),
            'phone': validated_data.pop('phone', ''),
            'birth_date': validated_data.pop('birth_date', None),
            'gender': validated_data.pop('gender', None),
        }

        # Remove password_confirm
        validated_data.pop('password_confirm')

        # Extract M2M field
        allowed_brands = validated_data.pop('allowed_brands', [])
        # Extract optional RBAC role — assigned at company scope below.
        role = validated_data.pop('role_id', None)

        # Generate matricule if not provided
        if not validated_data.get('matricule'):
            company = validated_data.get('current_company')
            validated_data['matricule'] = self.generate_matricule(company)

        # Extract password
        password = validated_data.pop('password')

        # Create user
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()

        # Set allowed brands (M2M)
        if allowed_brands:
            user.allowed_brands.set(allowed_brands)

        # Assign the RBAC role at exactly the scope ``role.scope_type``
        # asks for. Setting ``brand=allowed_brands[0]`` unconditionally
        # would narrow a company-scoped role (CEO / Viewer) below its
        # natural scope and the permission resolver would never match.
        # ``scope_kwargs_for_role`` returns the right column triple.
        if role is not None:
            from apps.rbac.models import UserRole
            from apps.rbac.services import scope_kwargs_for_role

            request = self.context.get('request')
            assigner = request.user if request and request.user.is_authenticated else None
            scope = scope_kwargs_for_role(
                role,
                company=user.current_company,
                brands=allowed_brands,
                sales_channel=None,
            )
            UserRole.objects.create(
                user=user,
                role=role,
                assigned_by=assigner,
                **scope,
            )
        
        # Update profile (signal auto-creates it, so we update instead of create)
        # Filter out None values to let model defaults apply
        profile_data = {k: v for k, v in profile_data.items() if v is not None and v != ''}
        if profile_data:
            Profile.objects.filter(user=user).update(**profile_data)
        
        return user


class UpdateUserSerializer(serializers.ModelSerializer):
    """
    Update an existing user.

    ``current_company`` is editable by platform admins only — moving a
    user between tenants is a high-impact action: it must also re-target
    the user's RBAC assignments so the permission resolver keeps
    matching at the new company scope. Non-platform admins get a
    permission error if they try to write the field.
    """

    class Meta:
        model = User
        fields = [
            'email',
            'first_name',
            'last_name',
            'current_company',
            'allowed_brands',
            'assigned_sales_channel',
            'is_active',
        ]

    def _is_platform_admin(self):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return user.user_roles.filter(role__scope_type='platform').exists()

    def validate_current_company(self, value):
        """Only platform admins may change a user's tenant."""
        instance = self.instance
        if instance and value and instance.current_company_id != getattr(value, 'id', None):
            if not self._is_platform_admin():
                raise serializers.ValidationError(
                    'Only a platform admin can move a user between companies.'
                )
        return value

    def validate(self, attrs):
        """Validate ``allowed_brands`` against the *incoming* company.

        The previous validator looked at ``instance.current_company``, so
        changing company + brands in the same request always failed the
        brand-belongs-to-company check (because it ran against the OLD
        company). Resolve the effective target company first.
        """
        # ``self.instance`` is ``None`` on create paths, but this serializer
        # is only registered for update / partial_update.
        instance = self.instance
        effective_company = (
            attrs.get('current_company')
            or (instance.current_company if instance else None)
        )
        brands = attrs.get('allowed_brands')
        if brands is not None:
            if not effective_company:
                if brands:
                    raise serializers.ValidationError({
                        'allowed_brands': 'Cannot assign brands to a user without a company.',
                    })
            else:
                invalid = [
                    b.name for b in brands
                    if b.company_id != getattr(effective_company, 'id', None)
                ]
                if invalid:
                    raise serializers.ValidationError({
                        'allowed_brands': (
                            f"The following brands do not belong to the user's company: "
                            f"{', '.join(invalid)}"
                        ),
                    })

        # ``assigned_sales_channel`` pins an operational account (Employee /
        # Cashier) to a single sales point. Validate it against the effective
        # company and the user's brand access so a sales point can never be set
        # outside the tenant — or in a brand the user cannot reach.
        channel = attrs.get('assigned_sales_channel')
        if channel is not None:
            eff_company_id = getattr(effective_company, 'id', None)
            if not eff_company_id or channel.brand.company_id != eff_company_id:
                raise serializers.ValidationError({
                    'assigned_sales_channel': "Sales channel does not belong to the user's company.",
                })
            eff_brands = attrs.get('allowed_brands')
            if eff_brands is None and instance is not None:
                eff_brands = list(instance.allowed_brands.all())
            eff_brand_ids = {getattr(b, 'id', b) for b in (eff_brands or [])}
            if eff_brand_ids and channel.brand_id not in eff_brand_ids:
                raise serializers.ValidationError({
                    'assigned_sales_channel': "Sales channel must belong to one of the user's brands.",
                })
        return attrs

    @transaction.atomic
    def update(self, instance, validated_data):
        """
        Apply the update, then re-target the user's UserRole rows if the
        ``current_company`` changed.

        Without re-targeting, every UserRole row keeps pointing at the
        OLD company — the permission resolver matches at scope X by
        looking for ``company=X``, so the user resolves to zero perms in
        the new tenant. We update the company column on each row and
        also clear ``brand`` / ``sales_channel`` when those records
        don't belong to the new company (a brand-scoped Manager row
        that referenced a brand on the old company is no longer valid).
        """
        new_company = validated_data.get('current_company', instance.current_company)
        old_company_id = instance.current_company_id
        new_company_id = getattr(new_company, 'id', None)
        moved = old_company_id != new_company_id

        # If we're moving tenants, drop ``allowed_brands`` that don't
        # belong to the new company. The validate() step already
        # rejected an explicit brand list that didn't fit, so this only
        # affects the "company changed but client didn't send a new
        # brand list" path.
        if moved and 'allowed_brands' not in validated_data:
            if new_company_id is not None:
                still_valid = list(
                    instance.allowed_brands.filter(company_id=new_company_id)
                )
                validated_data['allowed_brands'] = still_valid
            else:
                validated_data['allowed_brands'] = []

        user = super().update(instance, validated_data)

        if moved:
            from apps.rbac.models import UserRole
            from apps.brands.models import Brand
            from apps.sales_channels.models import SalesChannel

            new_brand_ids = set(
                Brand.objects.filter(company_id=new_company_id).values_list('id', flat=True)
            ) if new_company_id else set()
            new_channel_ids = set(
                SalesChannel.objects.filter(brand__company_id=new_company_id).values_list('id', flat=True)
            ) if new_company_id else set()

            for ur in UserRole.objects.filter(user=user):
                changed = False
                if ur.company_id != new_company_id:
                    ur.company_id = new_company_id
                    changed = True
                # A brand-scoped row pointing at a brand on the old company
                # is now meaningless — clear it (admin can re-scope later).
                if ur.brand_id and ur.brand_id not in new_brand_ids:
                    ur.brand_id = None
                    changed = True
                if ur.sales_channel_id and ur.sales_channel_id not in new_channel_ids:
                    ur.sales_channel_id = None
                    changed = True
                if changed:
                    ur.save(update_fields=['company', 'brand', 'sales_channel'])

        # Keep channel-scoped role rows (e.g. Cashier) pinned to the user's
        # current sales point. Changing ``assigned_sales_channel`` without a
        # role change would otherwise leave the existing UserRole resolving
        # permissions at the OLD sales point.
        if 'assigned_sales_channel' in validated_data:
            from apps.rbac.models import UserRole
            new_channel_id = user.assigned_sales_channel_id
            if new_channel_id:
                (UserRole.objects
                 .filter(user=user, role__scope_type='channel')
                 .exclude(sales_channel_id=new_channel_id)
                 .update(sales_channel_id=new_channel_id))

        return user


class ChangePasswordSerializer(serializers.Serializer):
    """
    Serializer for password change with role-based permission hierarchy.
    
    Permission Hierarchy:
    - Superadmin: Can change password for any user
    - CEO: Can change password for users within their company
    - Manager: Can change password for users within their brand(s)
    - Regular User: Can only change their own password
    """
    
    old_password = serializers.CharField(
        required=False,  # Not required when admin changes another user's password
        style={'input_type': 'password'},
        help_text='Required when changing your own password'
    )
    new_password = serializers.CharField(
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    new_password_confirm = serializers.CharField(
        required=True,
        style={'input_type': 'password'}
    )
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': 'New passwords do not match.'
            })
        
        # Check if old_password is required based on permission hierarchy
        target_user = self.context.get('target_user')
        requesting_user = self.context['request'].user
        
        # Use the permission check method to determine if old password is required
        can_skip_old_password = self._can_change_others_password(requesting_user, target_user)
        
        # Old password is required ONLY when user is changing their own password
        # Superadmin, CEO, Manager changing other users don't need old password
        if not can_skip_old_password and not attrs.get('old_password'):
            raise serializers.ValidationError({
                'old_password': 'This field is required when changing your own password.'
            })
        
        return attrs
    
    def validate_old_password(self, value):
        if not value:
            return value
            
        target_user = self.context.get('target_user') or self.context['request'].user
        requesting_user = self.context['request'].user
        
        # Skip old password check if authorized user is changing another user's password
        if self._can_change_others_password(requesting_user, target_user):
            return value
        
        if not target_user.check_password(value):
            raise serializers.ValidationError('Old password is incorrect.')
        return value
    
    def _can_change_others_password(self, requesting_user, target_user):
        """
        Check if requesting_user can change target_user's password.
        Returns True if authorized to skip old password verification.
        """
        # If no target user specified, assume self-change
        if target_user is None:
            return False
        
        # Same user = must verify old password
        if requesting_user == target_user:
            return False
        
        # Same user by ID comparison (in case objects are different instances)
        if requesting_user.id == target_user.id:
            return False
        
        # Superusers always pass.
        if requesting_user.is_superuser:
            return True

        # Permission-based authority — no hardcoded role names. The rules:
        #   1. ``edit_users`` at the TARGET's company scope ⇒ allowed.
        #      A CEO has ``edit_users`` at company scope and lands here.
        #   2. ``edit_users`` at any brand the target also belongs to ⇒
        #      allowed. A Manager scoped to brand X may change the
        #      password of a user in brand X.
        # If the role names ever change (e.g. "CEO" → "Chief Executive"),
        # nothing breaks here — the permission codename is the contract.
        from apps.rbac.services import PermissionService

        target_company = getattr(target_user, 'current_company', None)
        if target_company and PermissionService.has_permission(
            requesting_user, 'edit_users', company=target_company,
        ):
            return True

        target_brand_ids = set(target_user.allowed_brands.values_list('id', flat=True))
        if target_brand_ids:
            requester_brand_ids = set(
                requesting_user.allowed_brands.values_list('id', flat=True)
            )
            shared = target_brand_ids & requester_brand_ids
            from apps.brands.models import Brand
            for brand in Brand.objects.filter(pk__in=shared):
                if PermissionService.has_permission(
                    requesting_user, 'edit_users', brand=brand,
                ):
                    return True

        return False


# =============================================================================
# PASSWORD RESET SERIALIZERS
# =============================================================================

class ForgotPasswordSerializer(serializers.Serializer):
    """
    Serializer for forgot password request.
    Accepts email and sends reset link.
    """
    
    email = serializers.EmailField(required=True)
    
    def validate_email(self, value):
        """Check if user with this email exists."""
        value = value.lower()
        if not User.objects.filter(email=value).exists():
            # Don't reveal if email exists or not for security
            # Just silently accept - we'll return success either way
            pass
        return value
    
    def create(self, validated_data):
        """Generate reset token and send email."""
        email = validated_data['email']
        request = self.context.get('request')
        
        try:
            user = User.objects.get(email=email.lower())
            
            # Get client IP
            ip_address = None
            if request:
                x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
                if x_forwarded_for:
                    ip_address = x_forwarded_for.split(',')[0]
                else:
                    ip_address = request.META.get('REMOTE_ADDR')
            
            # Create reset token
            reset_token_obj, token = PasswordResetToken.create_for_user(
                user=user,
                ip_address=ip_address
            )
            
            # Build reset URL
            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173')
            reset_url = f"{frontend_url}/reset-password?token={token}&email={email}"
            
            # Send email
            subject = 'LkSystem - Password Reset Request'
            message = f"""
Hello {user.get_full_name() or user.matricule},

You requested a password reset for your LkSystem account.

Click the link below to reset your password:
{reset_url}

This link will expire in 1 hour.

If you did not request this reset, please ignore this email.

Best regards,
LkSystem Team
            """
            
            send_mail(
                subject=subject,
                message=message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=True,  # Don't raise errors in production
            )
            
        except User.DoesNotExist:
            # Silently fail - don't reveal if email exists
            pass
        
        return {'email': email}


class ResetPasswordSerializer(serializers.Serializer):
    """
    Serializer for resetting password with token.
    """
    
    email = serializers.EmailField(required=True)
    token = serializers.CharField(required=True)
    new_password = serializers.CharField(
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    new_password_confirm = serializers.CharField(
        required=True,
        style={'input_type': 'password'}
    )
    
    def validate(self, attrs):
        """Validate token and passwords match."""
        # Password confirmation
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': 'Passwords do not match.'
            })
        
        # Validate token
        email = attrs['email'].lower()
        token = attrs['token']
        
        try:
            user = User.objects.get(email=email)
            reset_token = PasswordResetToken.objects.get(
                user=user,
                token=token,
                is_used=False
            )
            
            if not reset_token.is_valid:
                raise serializers.ValidationError({
                    'token': 'This reset link has expired. Please request a new one.'
                })
            
            attrs['user'] = user
            attrs['reset_token'] = reset_token
            
        except User.DoesNotExist:
            raise serializers.ValidationError({
                'email': 'Invalid email address.'
            })
        except PasswordResetToken.DoesNotExist:
            raise serializers.ValidationError({
                'token': 'Invalid or expired reset token.'
            })
        
        return attrs
    
    def create(self, validated_data):
        """Reset the password."""
        user = validated_data['user']
        reset_token = validated_data['reset_token']
        new_password = validated_data['new_password']
        
        # Set new password
        user.set_password(new_password)
        user.save()
        
        # Mark token as used
        reset_token.mark_as_used()
        
        return {'success': True}


class ValidateResetTokenSerializer(serializers.Serializer):
    """Serializer for validating a reset token without resetting password."""

    email = serializers.EmailField(required=True)
    token = serializers.CharField(required=True)

    def validate(self, attrs):
        """Validate the token is valid."""
        email = attrs['email'].lower()
        token = attrs['token']

        try:
            user = User.objects.get(email=email)
            reset_token = PasswordResetToken.objects.get(
                user=user,
                token=token,
                is_used=False
            )

            if not reset_token.is_valid:
                raise serializers.ValidationError({
                    'token': 'This reset link has expired.'
                })

        except User.DoesNotExist:
            raise serializers.ValidationError({
                'email': 'Invalid email address.'
            })
        except PasswordResetToken.DoesNotExist:
            raise serializers.ValidationError({
                'token': 'Invalid or expired reset token.'
            })

        return attrs


# =============================================================================
# EMPLOYEE INVITATION SERIALIZERS
# =============================================================================

class InviteEmployeeSerializer(serializers.Serializer):
    """
    Admin/CEO/Manager invites an employee by email.
    The system sends a link; the invitee completes registration.
    """

    email = serializers.EmailField()
    role_id = serializers.IntegerField()
    company_id = serializers.IntegerField()
    brand_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    sales_channel_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_role_id(self, value):
        from apps.rbac.models import Role
        try:
            Role.objects.get(id=value)
        except Role.DoesNotExist:
            raise serializers.ValidationError('Role does not exist.')
        return value

    def validate_company_id(self, value):
        from apps.company.models import Company
        try:
            Company.objects.get(id=value)
        except Company.DoesNotExist:
            raise serializers.ValidationError('Company does not exist.')
        return value

    def validate(self, attrs):
        from apps.rbac.models import Role
        from apps.company.models import Company
        from apps.brands.models import Brand
        from apps.sales_channels.models import SalesChannel
        from apps.rbac.services import PermissionService

        company = Company.objects.get(id=attrs['company_id'])
        attrs['_company'] = company

        role = Role.objects.get(id=attrs['role_id'])
        attrs['_role'] = role

        # ── Inviter authority check ──────────────────────────────────────
        # Without this the endpoint was a privilege-escalation footgun: any
        # authenticated user could invite anyone to ANY role, including
        # Super Admin. Enforce two rules:
        #   (1) Inviter must hold ``create_users`` permission scoped to the
        #       target company. (Super-users always pass via the resolver.)
        #   (2) The target role's scope must not be wider than the
        #       inviter's own — a CEO can't invite a Super Admin, a
        #       Manager can't invite a CEO, etc.
        request = self.context.get('request')
        inviter = request.user if request else None
        if not inviter or not inviter.is_authenticated:
            raise serializers.ValidationError('Authentication required.')

        if not inviter.is_superuser:
            # Capability check across the inviter's active company INCLUDING its
            # brand/channel sub-scopes, so a brand-scoped Brand Manager (who holds
            # no company-wide role) can still invite within their own company.
            inviter_perms = PermissionService.get_capability_permissions(
                inviter, company=company,
            )
            if 'create_users' not in inviter_perms:
                raise serializers.ValidationError(
                    "You don't have permission to invite users to this company."
                )
            # The one escalation the permission ceiling below cannot catch: a
            # non-platform admin must never mint a platform-scoped (cross-company)
            # role, however small its permission set looks.
            if (role.scope_type or '').lower() == 'platform' \
                    and not PermissionService.is_platform_admin(inviter):
                raise serializers.ValidationError({
                    'role_id': "You can't invite a user to a platform-wide role.",
                })
            # Tenant isolation: the role must be one owned by the target
            # company, never a global template or another tenant's role.
            # A company-owned role must belong to the target company; a global
            # default role (company IS NULL, non-platform) may be assigned in any
            # company.
            if (role.scope_type != 'platform'
                    and role.company_id is not None
                    and role.company_id != company.id):
                raise serializers.ValidationError({
                    'role_id': 'You can only invite users to roles that belong '
                               'to this company.'
                })
            # Privilege ceiling — the real escalation guard: the inviter may only
            # grant a role whose permissions are a subset of their own. This lets
            # a Brand Manager invite an Employee or a Cashier (their permissions
            # are a subset) while still blocking a Manager / CEO / Super Admin
            # (those need permissions the Brand Manager does not hold) — derived
            # purely from permissions, with no role-name or scope-rank hard-coding.
            from apps.rbac.provisioning import assert_within_ceiling
            assert_within_ceiling(
                inviter, role.permissions.values_list('codename', flat=True)
            )

        # Validate brands belong to company
        brand_ids = attrs.get('brand_ids', [])
        if brand_ids:
            brands = Brand.objects.filter(id__in=brand_ids)
            invalid = brands.exclude(company=company)
            if invalid.exists():
                names = ', '.join(invalid.values_list('name', flat=True))
                raise serializers.ValidationError({
                    'brand_ids': f'These brands do not belong to the company: {names}'
                })
            attrs['_brands'] = list(brands)
        else:
            attrs['_brands'] = []

        # Validate sales channel belongs to company
        sc_id = attrs.get('sales_channel_id')
        if sc_id:
            try:
                sc = SalesChannel.objects.get(id=sc_id)
            except SalesChannel.DoesNotExist:
                raise serializers.ValidationError({
                    'sales_channel_id': 'Sales channel does not exist.'
                })
            if sc.brand.company_id != company.id:
                raise serializers.ValidationError({
                    'sales_channel_id': 'Sales channel does not belong to this company.'
                })
            attrs['_sales_channel'] = sc
        else:
            attrs['_sales_channel'] = None

        # ── Scope-shape validation for the target role ───────────────────
        # The accept path needs the right ingredients to mint a UserRole
        # whose scope columns match ``role.scope_type``. Catch missing
        # ingredients now (clear error to the inviter) rather than later
        # (silent zero-permission account).
        scope = (role.scope_type or '').lower()
        if scope == 'brand' and not attrs['_brands']:
            raise serializers.ValidationError({
                'brand_ids': (
                    f"{role.name} is brand-scoped — pick at least one brand. "
                    f"Without it the resulting user would have no effective permissions."
                ),
            })
        if scope == 'channel' and not attrs['_sales_channel']:
            raise serializers.ValidationError({
                'sales_channel_id': (
                    f"{role.name} is channel-scoped — pick a sales channel."
                ),
            })

        # Operational, single-sales-point roles (Employee / Cashier) must be
        # pinned to a sales point even when the role itself is company-scoped,
        # so the new account is confined to exactly one channel.
        from apps.rbac.services import role_requires_sales_point
        if role_requires_sales_point(role) and not attrs['_sales_channel']:
            raise serializers.ValidationError({
                'sales_channel_id': (
                    f"{role.name} works at a single sales point — pick the sales "
                    f"channel this user will operate."
                ),
            })

        return attrs

    def create(self, validated_data):
        request = self.context['request']

        invitation = Invitation.create_invitation(
            email=validated_data['email'],
            role=validated_data['_role'],
            company=validated_data['_company'],
            brands=validated_data['_brands'],
            sales_channel=validated_data['_sales_channel'],
            invited_by=request.user,
        )

        # Send invitation email
        frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173')
        invite_url = (
            f"{frontend_url}/accept-invitation"
            f"?token={invitation.token}&email={invitation.email}"
        )

        subject = 'LkSystem - You\'ve Been Invited'
        message = (
            f"Hello,\n\n"
            f"You've been invited to join LkSystem by "
            f"{request.user.get_full_name() or request.user.matricule}.\n\n"
            f"Click the link below to create your account:\n"
            f"{invite_url}\n\n"
            f"This link expires in 72 hours.\n\n"
            f"Best regards,\n"
            f"LkSystem Team"
        )

        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invitation.email],
            fail_silently=True,
        )

        return invitation


class InvitationDetailSerializer(serializers.ModelSerializer):
    """Read-only serializer for listing invitations."""

    role_name = serializers.CharField(source='role.name', read_only=True)
    company_name = serializers.CharField(source='company.name', read_only=True)
    invited_by_name = serializers.SerializerMethodField()
    brand_names = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = [
            'id', 'token', 'email', 'status',
            'role', 'role_name',
            'company', 'company_name',
            'brand_names',
            'sales_channel',
            'invited_by', 'invited_by_name',
            'expires_at', 'created_at', 'accepted_at',
        ]

    def get_invited_by_name(self, obj):
        return obj.invited_by.get_full_name() if obj.invited_by else None

    def get_brand_names(self, obj):
        return list(obj.brands.values_list('name', flat=True))


class ValidateInvitationSerializer(serializers.Serializer):
    """Validate an invitation token (public — no auth required)."""

    token = serializers.CharField()
    email = serializers.EmailField()

    def validate(self, attrs):
        email = attrs['email'].lower()
        try:
            invitation = Invitation.objects.select_related(
                'role', 'company',
            ).get(
                token=attrs['token'],
                email=email,
                status=Invitation.Status.PENDING,
            )
        except Invitation.DoesNotExist:
            raise serializers.ValidationError({
                'token': 'Invalid or expired invitation.'
            })

        if not invitation.is_valid:
            raise serializers.ValidationError({
                'token': 'This invitation has expired.'
            })

        attrs['_invitation'] = invitation
        return attrs


class AcceptInvitationSerializer(serializers.Serializer):
    """
    Public endpoint: invitee sets password + name to create their account.
    """

    token = serializers.CharField()
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    password = serializers.CharField(
        write_only=True,
        validators=[validate_password],
        style={'input_type': 'password'},
    )
    password_confirm = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
    )

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({
                'password_confirm': 'Passwords do not match.'
            })

        email = attrs['email'].lower()
        try:
            invitation = Invitation.objects.select_related(
                'role', 'company', 'sales_channel',
            ).prefetch_related('brands').get(
                token=attrs['token'],
                email=email,
                status=Invitation.Status.PENDING,
            )
        except Invitation.DoesNotExist:
            raise serializers.ValidationError({
                'token': 'Invalid or expired invitation.'
            })

        if not invitation.is_valid:
            raise serializers.ValidationError({
                'token': 'This invitation has expired.'
            })

        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError({
                'email': 'A user with this email already exists.'
            })

        attrs['_invitation'] = invitation
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        from apps.rbac.models import UserRole

        invitation = validated_data['_invitation']
        company = invitation.company

        # Sanity guards — an invitation that lost its role or company
        # post-creation (e.g. the role was deleted while pending) must not
        # silently produce a zero-permission user. Fail loudly instead.
        if invitation.role is None:
            raise serializers.ValidationError({
                'token': 'This invitation\'s role no longer exists. Please request a new invitation.',
            })
        if company is None:
            raise serializers.ValidationError({
                'token': 'This invitation\'s company no longer exists. Please request a new invitation.',
            })

        # Generate matricule
        prefix = company.abbreviation if company else 'SYS'
        last_user = User.objects.filter(
            matricule__startswith=f"{prefix}-"
        ).order_by('-matricule').first()

        if last_user:
            try:
                next_num = int(last_user.matricule.split('-')[-1]) + 1
            except (ValueError, IndexError):
                next_num = 1
        else:
            next_num = 1

        matricule = f"{prefix}-{next_num:04d}"

        # Create user
        user = User.objects.create(
            matricule=matricule,
            email=invitation.email,
            first_name=validated_data['first_name'],
            last_name=validated_data['last_name'],
            current_company=company,
            is_active=True,
        )
        user.set_password(validated_data['password'])
        user.save(update_fields=['password'])

        # Assign brands
        brands = list(invitation.brands.all())
        if brands:
            user.allowed_brands.set(brands)

        # Create profile stub
        Profile.objects.get_or_create(user=user)

        # Assign the RBAC role(s). For brand-scoped roles with multiple
        # invited brands we mint one UserRole per brand — that's the only
        # way the permission resolver matches each brand correctly. For
        # company- or platform-scoped roles a single UserRole is correct.
        from apps.rbac.services import scope_kwargs_for_role
        role_scope = (invitation.role.scope_type or '').lower()
        if role_scope == 'brand' and len(brands) > 1:
            for brand in brands:
                UserRole.objects.create(
                    user=user,
                    role=invitation.role,
                    company=company,
                    brand=brand,
                    sales_channel=None,
                    assigned_by=invitation.invited_by,
                )
        else:
            scope = scope_kwargs_for_role(
                invitation.role,
                company=company,
                brands=brands,
                sales_channel=invitation.sales_channel,
            )
            UserRole.objects.create(
                user=user,
                role=invitation.role,
                assigned_by=invitation.invited_by,
                **scope,
            )

        # Pin operational accounts to their assigned sales point so every read
        # is confined to that one channel (and its brand). Set whenever the
        # invite carried a sales channel — a Cashier, or an Employee assigned
        # one — regardless of the role's nominal scope.
        if invitation.sales_channel_id:
            user.assigned_sales_channel_id = invitation.sales_channel_id
            user.current_brand_id = invitation.sales_channel.brand_id
            user.save(update_fields=['assigned_sales_channel', 'current_brand'])
            user.allowed_brands.add(invitation.sales_channel.brand_id)

        invitation.mark_accepted(user)

        return user

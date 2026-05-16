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
        """Override to add extra response data including RBAC permissions."""
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
            'can_switch_brands': can_switch,
            'company_id': (
                user.current_company.id if user.current_company else None
            ),
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
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()

    def get_role_name(self, obj):
        from apps.rbac.services import PermissionService
        names = PermissionService.get_user_role_names(obj)
        return names[0] if names else None


class UserDetailSerializer(serializers.ModelSerializer):
    """Detailed User serializer with profile and brands."""

    role_name = serializers.SerializerMethodField()
    company_name = serializers.CharField(source='current_company.name', read_only=True)
    full_name = serializers.SerializerMethodField()
    profile = ProfileSerializer(read_only=True)
    allowed_brand_ids = serializers.SerializerMethodField()
    can_switch_brands = serializers.SerializerMethodField()

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
            'can_switch_brands',
            'is_active',
            'is_staff',
            'date_joined',
            'last_login',
            'profile',
        ]
        read_only_fields = ['id', 'matricule', 'date_joined', 'last_login']

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
        ]
        read_only_fields = ['matricule']  # Auto-generated on creation
        extra_kwargs = {
            'current_company': {'required': False},
            'allowed_brands': {'required': False},
        }
    
    def validate(self, attrs):
        """Validate passwords match and brands belong to company."""
        # Password confirmation
        if attrs.get('password') != attrs.get('password_confirm'):
            raise serializers.ValidationError({
                'password_confirm': 'Passwords do not match.'
            })
        
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
        """Create User and Profile atomically."""
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
        
        # Update profile (signal auto-creates it, so we update instead of create)
        # Filter out None values to let model defaults apply
        profile_data = {k: v for k, v in profile_data.items() if v is not None and v != ''}
        if profile_data:
            Profile.objects.filter(user=user).update(**profile_data)
        
        return user


class UpdateUserSerializer(serializers.ModelSerializer):
    """Serializer for updating user information."""
    
    class Meta:
        model = User
        fields = [
            'email',
            'first_name',
            'last_name',
            'allowed_brands',
            'is_active',
        ]
    
    def validate_allowed_brands(self, value):
        """Ensure brands belong to user's company."""
        user = self.instance
        if not user or not user.current_company:
            if value:
                raise serializers.ValidationError(
                    'Cannot assign brands to user without a company.'
                )
            return value
        
        invalid_brands = []
        for brand in value:
            if brand.company_id != user.current_company_id:
                invalid_brands.append(brand.name)
        
        if invalid_brands:
            raise serializers.ValidationError(
                f"The following brands do not belong to the user's company: "
                f"{', '.join(invalid_brands)}"
            )
        
        return value


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
        
        # Superadmin can change anyone's password (check is_superuser flag)
        if requesting_user.is_superuser:
            return True
        
        # Check RBAC roles
        from apps.rbac.services import PermissionService
        role_names = [r.upper() for r in PermissionService.get_user_role_names(requesting_user)]

        if 'SUPER ADMIN' in role_names:
            return True

        if 'CEO' in role_names:
            if (requesting_user.current_company and
                target_user.current_company and
                target_user.current_company.id == requesting_user.current_company.id):
                return True

        if 'MANAGER' in role_names:
            requesting_user_brands = set(requesting_user.allowed_brands.values_list('id', flat=True))
            target_user_brands = set(target_user.allowed_brands.values_list('id', flat=True))
            if requesting_user_brands & target_user_brands:
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

        company = Company.objects.get(id=attrs['company_id'])
        attrs['_company'] = company

        role = Role.objects.get(id=attrs['role_id'])
        attrs['_role'] = role

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

        # Assign RBAC role with scope
        UserRole.objects.create(
            user=user,
            role=invitation.role,
            company=company,
            brand=brands[0] if len(brands) == 1 else None,
            sales_channel=invitation.sales_channel,
            assigned_by=invitation.invited_by,
        )

        invitation.mark_accepted(user)

        return user
